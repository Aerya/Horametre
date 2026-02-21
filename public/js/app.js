/**
 * Horamètre - Calculateur d'heures de travail
 * CCN Jardineries & Graineteries (IDCC 1760)
 * Backend: SQLite via API
 */

const App = (() => {
    // --- API module ---
    const API = {
        async getEmployees() {
            const res = await fetch('/api/employees');
            if (res.status === 401) return handleUnauthorized();
            return res.json();
        },
        async createEmployee(name) {
            const res = await fetch('/api/employees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            return res.json();
        },
        async updateEmployee(id, data) {
            const res = await fetch(`/api/employees/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.json();
        },
        async deleteEmployee(id) {
            const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
            return res.json();
        },
        async getEntries(employeeId, start, end) {
            const res = await fetch(`/api/employees/${employeeId}/entries?start=${start}&end=${end}`);
            return res.json();
        },
        async saveEntries(employeeId, entries) {
            const res = await fetch(`/api/employees/${employeeId}/entries`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries })
            });
            return res.json();
        },
        async getAllEntries(start, end) {
            const res = await fetch(`/api/entries/all?start=${start}&end=${end}`);
            return res.json();
        },
        async getSettings() {
            const res = await fetch('/api/settings');
            return res.json();
        },
        async saveSettings(settings) {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            return res.json();
        }
    };

    // Employee color palette for merged view
    const EMPLOYEE_COLORS = [
        '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
        '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
    ];

    let state = {
        employees: [],
        currentEmployeeId: null,
        mergedView: false,
        entries: [],
        dateRange: { start: null, end: null },
        grossMonthlySalary: 0,
        contractBase: 35,
        currentResults: null,
        quickMode: false,
        quickTemplate: { start: '10:00', end: '19:00', breakDuration: 60 },
        viewMode: 'list',
        theme: 'dark',
        currentWeekIndex: 0,
        saving: false
    };

    // --- Date helpers ---
    function getMonday(d) {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        date.setDate(diff);
        return date;
    }

    function formatDate(date) {
        if (!date) return '';
        return date.toISOString().split('T')[0];
    }

    function parseDateLocal(str) {
        const [y, m, d] = str.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function getDaysBetween(start, end) {
        const days = [];
        const d = new Date(start);
        while (d <= end) {
            days.push(formatDate(new Date(d)));
            d.setDate(d.getDate() + 1);
        }
        return days;
    }

    // --- Initialize ---
    async function init() {
        // Check auth status
        try {
            const authRes = await fetch('/api/auth/status');
            const auth = await authRes.json();
            const logoutBtn = document.getElementById('btn-logout');
            if (logoutBtn && auth.authEnabled) {
                logoutBtn.style.display = '';
                logoutBtn.addEventListener('click', async () => {
                    await fetch('/api/auth/logout', { method: 'POST' });
                    window.location.href = '/login';
                });
            }
        } catch (e) {
            console.warn('Auth status check failed:', e);
        }

        // Load settings
        try {
            const settings = await API.getSettings();
            if (settings.theme) state.theme = settings.theme;
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }

        applyTheme();
        setupDateRange('month');
        setupEventListeners();

        // Load employees
        await refreshEmployeeList();

        // Load shared data if present
        loadSharedData();
    }

    function setupDateRange(mode) {
        const now = new Date();
        let start, end;

        if (mode === 'week') {
            start = getMonday(now);
            end = new Date(start);
            end.setDate(end.getDate() + 6);
        } else if (mode === 'month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }

        if (start && end) {
            state.dateRange.start = start;
            state.dateRange.end = end;

            // Format dates for inputs
            const startStr = formatDate(start);
            const endStr = formatDate(end);

            document.getElementById('date-start').value = startStr;
            document.getElementById('date-end').value = endStr;

            // If month mode, sync the month picker
            if (mode === 'month') {
                const monthVal = `${start.getFullYear()}-${(start.getMonth() + 1).toString().padStart(2, '0')}`;
                document.getElementById('month-picker').value = monthVal;
            }
        }
        initEntries();
    }

    function initEntries() {
        if (!state.dateRange.start || !state.dateRange.end) return;
        const days = getDaysBetween(state.dateRange.start, state.dateRange.end);
        state.entries = days.map(date => ({
            date,
            start: '',
            end: '',
            breakDuration: 0
        }));
        renderEntries();
        updateResults();
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        // Date range
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setupDateRange(btn.dataset.range);
                loadCurrentEntries();
            });
        });

        document.getElementById('date-start').addEventListener('change', async (e) => {
            state.dateRange.start = parseDateLocal(e.target.value);
            initEntries();
            await loadCurrentEntries();
        });

        document.getElementById('date-end').addEventListener('change', async (e) => {
            state.dateRange.end = parseDateLocal(e.target.value);
            initEntries();
            await loadCurrentEntries();
        });

        // Month picker
        const monthPicker = document.getElementById('month-picker');
        if (monthPicker) {
            monthPicker.addEventListener('change', async (e) => {
                const val = e.target.value;
                if (!val) return;

                // Deselect other range buttons and select month
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                const monthBtn = document.querySelector('.range-btn[data-range="month"]');
                if (monthBtn) monthBtn.classList.add('active');

                const [year, month] = val.split('-').map(Number);
                const start = new Date(year, month - 1, 1);
                const end = new Date(year, month, 0);

                state.dateRange.start = start;
                state.dateRange.end = end;

                document.getElementById('date-start').value = formatDate(start);
                document.getElementById('date-end').value = formatDate(end);

                initEntries();
                await loadCurrentEntries();
            });
        }

        // Employee selector
        document.getElementById('employee-select').addEventListener('change', async (e) => {
            const id = parseInt(e.target.value);
            if (id) {
                state.mergedView = false;
                document.getElementById('btn-merged-view').classList.remove('active');
                await selectEmployee(id);
            } else {
                state.currentEmployeeId = null;
                document.getElementById('btn-delete-employee').style.display = 'none';
                initEntries();
            }
        });

        // Add employee
        document.getElementById('btn-add-employee').addEventListener('click', openModal);
        document.getElementById('btn-confirm-add-employee').addEventListener('click', async () => {
            const nameInput = document.getElementById('new-employee-name');
            const name = nameInput.value.trim();
            if (!name) {
                showToast('Veuillez saisir un nom', 'warning');
                nameInput.focus();
                return;
            }
            try {
                const result = await API.createEmployee(name);
                if (result.error) {
                    showToast(result.error, 'warning');
                    return;
                }
                nameInput.value = '';
                closeModal();
                await refreshEmployeeList();
                await selectEmployee(result.id);
                showToast(`${name} créé`, 'success');
            } catch (e) {
                showToast('Erreur lors de la création', 'error');
            }
        });

        // Delete employee
        document.getElementById('btn-delete-employee').addEventListener('click', async () => {
            if (!state.currentEmployeeId) return;
            const emp = state.employees.find(e => e.id === state.currentEmployeeId);
            if (!emp) return;
            if (!confirm(`Supprimer ${emp.name} et toutes ses heures ?`)) return;
            try {
                await API.deleteEmployee(state.currentEmployeeId);
                state.currentEmployeeId = null;
                await refreshEmployeeList();
                initEntries();
                showToast(`${emp.name} supprimé`, 'info');
            } catch (e) {
                showToast('Erreur lors de la suppression', 'error');
            }
        });

        // Merged view
        document.getElementById('btn-merged-view').addEventListener('click', async () => {
            state.mergedView = !state.mergedView;
            document.getElementById('btn-merged-view').classList.toggle('active', state.mergedView);
            if (state.mergedView) {
                document.getElementById('employee-select').value = '';
                state.currentEmployeeId = null;
                await loadMergedEntries();
            } else {
                initEntries();
            }
        });

        // Salary & contract base
        document.getElementById('gross-salary').addEventListener('input', async (e) => {
            state.grossMonthlySalary = parseFloat(e.target.value) || 0;
            updateHourlyRateDisplay();
            updateResults();
            await saveCurrentEmployeeConfig();
        });

        document.querySelectorAll('.contract-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                state.contractBase = parseInt(btn.dataset.base);
                document.querySelectorAll('.contract-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                updateHourlyRateDisplay();
                updateResults();
                await saveCurrentEmployeeConfig();
            });
        });

        // Theme toggle
        const themeButton = document.getElementById('theme-toggle');
        if (themeButton) {
            themeButton.addEventListener('click', toggleTheme);
        }

        // View toggle
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                state.viewMode = view;
                switchView();
            });
        });

        // Quick mode
        const quickToggle = document.getElementById('quick-mode-toggle');
        if (quickToggle) quickToggle.addEventListener('change', toggleQuickMode);

        document.getElementById('quick-start')?.addEventListener('change', (e) => {
            state.quickTemplate.start = e.target.value;
        });
        document.getElementById('quick-end')?.addEventListener('change', (e) => {
            state.quickTemplate.end = e.target.value;
        });
        document.getElementById('quick-break')?.addEventListener('change', (e) => {
            state.quickTemplate.breakDuration = parseInt(e.target.value) || 0;
        });

        // Quick select weekdays
        document.getElementById('btn-quick-weekdays')?.addEventListener('click', quickSelectWeekdays);

        // Clear
        document.getElementById('btn-clear').addEventListener('click', clearAllEntries);

        // Save
        document.getElementById('btn-save').addEventListener('click', saveCurrentEntries);

        // PDF / Print / Share
        document.getElementById('btn-pdf')?.addEventListener('click', printPlanning);
        document.getElementById('btn-print')?.addEventListener('click', printPlanning);
        document.getElementById('btn-share')?.addEventListener('click', shareResults);

        // Backup
        document.getElementById('btn-backup')?.addEventListener('click', async () => {
            try {
                const btn = document.getElementById('btn-backup');
                const svg = btn.innerHTML;
                btn.innerHTML = 'Progression...';
                btn.disabled = true;

                const res = await fetch('/api/backup', { method: 'POST' });
                const json = await res.json();

                btn.innerHTML = svg;
                btn.disabled = false;

                if (res.ok && json.success) {
                    showToast('Sauvegarde BDD réussie' + (json.ftp ? ' (+ FTP)' : ''), 'success');
                } else {
                    showToast('Erreur lors de la sauvegarde: ' + (json.error || 'Erreur inconnue'), 'error');
                }
            } catch (err) {
                showToast('Erreur serveur pour la sauvegarde', 'error');
                const btn = document.getElementById('btn-backup');
                btn.disabled = false;
            }
        });

        // Modal
        document.getElementById('modal-close').addEventListener('click', closeModal);

        // Close modal on backdrop click
        document.getElementById('add-employee-modal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) closeModal();
        });

        // Enter key in modal
        document.getElementById('new-employee-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('btn-confirm-add-employee').click();
            }
        });
    }

    // --- Employee management ---
    async function refreshEmployeeList() {
        try {
            state.employees = await API.getEmployees();
        } catch (e) {
            state.employees = [];
            console.warn('Failed to load employees:', e);
        }
        renderEmployeeSelect();
    }

    function renderEmployeeSelect() {
        const select = document.getElementById('employee-select');
        const currentValue = select.value;

        // Keep the placeholder
        select.innerHTML = '<option value="">— Sélectionner —</option>';

        state.employees.forEach((emp, idx) => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = emp.name;
            opt.style.color = EMPLOYEE_COLORS[idx % EMPLOYEE_COLORS.length];
            select.appendChild(opt);
        });

        // Restore selection
        if (state.currentEmployeeId) {
            select.value = state.currentEmployeeId;
        }
    }

    async function selectEmployee(id) {
        state.currentEmployeeId = id;
        const emp = state.employees.find(e => e.id === id);
        if (!emp) return;

        // Update UI
        document.getElementById('employee-select').value = id;
        document.getElementById('btn-delete-employee').style.display = '';

        // Load employee config
        state.grossMonthlySalary = emp.gross_monthly_salary || 0;
        state.contractBase = emp.contract_base || 35;

        document.getElementById('gross-salary').value = state.grossMonthlySalary || '';
        document.querySelectorAll('.contract-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.base) === state.contractBase);
        });

        updateHourlyRateDisplay();
        await loadCurrentEntries();
    }

    async function saveCurrentEmployeeConfig() {
        if (!state.currentEmployeeId) return;
        try {
            await API.updateEmployee(state.currentEmployeeId, {
                gross_monthly_salary: state.grossMonthlySalary,
                contract_base: state.contractBase
            });
        } catch (e) {
            console.warn('Failed to save employee config:', e);
        }
    }

    // --- Entries ---
    async function loadCurrentEntries() {
        if (!state.currentEmployeeId || !state.dateRange.start || !state.dateRange.end) return;

        try {
            const start = formatDate(state.dateRange.start);
            const end = formatDate(state.dateRange.end);
            const dbEntries = await API.getEntries(state.currentEmployeeId, start, end);

            // Map DB entries onto the day grid
            const dbMap = {};
            for (const e of dbEntries) {
                dbMap[e.date] = e;
            }

            const days = getDaysBetween(state.dateRange.start, state.dateRange.end);
            state.entries = days.map(date => {
                const db = dbMap[date];
                return {
                    date,
                    start: db ? db.start : '',
                    end: db ? db.end : '',
                    breakDuration: db ? db.break_duration : 0
                };
            });

            renderEntries();
            updateResults();
        } catch (e) {
            console.warn('Failed to load entries:', e);
        }
    }

    async function saveCurrentEntries() {
        if (!state.currentEmployeeId) {
            showToast('Sélectionnez un employé d\'abord', 'warning');
            return;
        }
        if (state.saving) return;
        state.saving = true;

        try {
            // Only save entries with data
            const toSave = state.entries.filter(e => e.start || e.end || e.breakDuration);
            await API.saveEntries(state.currentEmployeeId, toSave);
            showToast('Heures sauvegardées', 'success');
        } catch (e) {
            showToast('Erreur lors de la sauvegarde', 'error');
            console.error(e);
        } finally {
            state.saving = false;
        }
    }

    // Auto-save on entry change (debounced)
    let autoSaveTimer = null;
    function scheduleAutoSave() {
        if (!state.currentEmployeeId) return;
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(async () => {
            try {
                const toSave = state.entries.filter(e => e.start || e.end || e.breakDuration);
                await API.saveEntries(state.currentEmployeeId, toSave);
            } catch (e) {
                console.warn('Auto-save failed:', e);
            }
        }, 1500);
    }

    // --- Merged view ---
    async function loadMergedEntries() {
        if (!state.dateRange.start || !state.dateRange.end) return;

        try {
            const start = formatDate(state.dateRange.start);
            const end = formatDate(state.dateRange.end);
            const allEntries = await API.getAllEntries(start, end);

            // Group by employee for results
            const byEmployee = {};
            for (const entry of allEntries) {
                if (!byEmployee[entry.employee_name]) {
                    byEmployee[entry.employee_name] = {
                        name: entry.employee_name,
                        salary: entry.gross_monthly_salary,
                        contractBase: entry.contract_base,
                        entries: []
                    };
                }
                byEmployee[entry.employee_name].entries.push({
                    date: entry.date,
                    start: entry.start,
                    end: entry.end,
                    breakDuration: entry.break_duration
                });
            }

            renderMergedView(byEmployee);
        } catch (e) {
            console.warn('Failed to load merged entries:', e);
        }
    }

    function renderMergedView(byEmployee) {
        const tbody = document.getElementById('entries-body');
        tbody.innerHTML = '';

        const days = getDaysBetween(state.dateRange.start, state.dateRange.end);
        const employeeNames = Object.keys(byEmployee);

        if (employeeNames.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5; padding:24px;">Aucun employé avec des heures saisies sur cette période</td></tr>';
            return;
        }

        for (const date of days) {
            const dateObj = parseDateLocal(date);
            const dayName = dateObj.toLocaleDateString('fr-FR', { weekday: 'short' });
            const dateDisplay = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            const holiday = FrenchRules.isPublicHoliday(dateObj);
            const isSunday = dateObj.getDay() === 0;
            const isSaturday = dateObj.getDay() === 6;

            let hasAnyEntry = false;

            for (let empIdx = 0; empIdx < employeeNames.length; empIdx++) {
                const empName = employeeNames[empIdx];
                const empData = byEmployee[empName];
                const entry = empData.entries.find(e => e.date === date);
                const color = EMPLOYEE_COLORS[empIdx % EMPLOYEE_COLORS.length];
                const hoursWorked = entry ? FrenchRules.calculateDailyHours(entry) : 0;

                if (!entry && !hasAnyEntry && empIdx === employeeNames.length - 1) {
                    // No employee has hours for this day → show off row
                    const tr = document.createElement('tr');
                    tr.classList.add('day-off-row');
                    if (holiday) tr.classList.add('holiday-row');
                    if (isSunday) tr.classList.add('sunday-row');
                    if (isSaturday) tr.classList.add('saturday-row');
                    if (date === days[0] || dateObj.getDay() === 1) {
                        const prevDate = days.indexOf(date) > 0 ? parseDateLocal(days[days.indexOf(date) - 1]) : null;
                        if (prevDate && prevDate.getDay() !== 0) tr.classList.add('week-start');
                    }

                    tr.innerHTML = `
                        <td class="cell-day">
                            <span class="day-name">${capitalizeFirst(dayName)}</span>
                            <span class="day-date">${dateDisplay}</span>
                            ${holiday ? `<span class="holiday-badge" title="${holiday.name}">🏴 ${holiday.name}</span>` : ''}
                        </td>
                        <td class="cell-time" colspan="3" style="text-align:center; opacity:0.4;">—</td>
                        <td class="cell-hours">-</td>
                    `;
                    tbody.appendChild(tr);
                    continue;
                }

                if (!entry || hoursWorked === 0) continue;
                hasAnyEntry = true;

                const tr = document.createElement('tr');
                if (holiday) tr.classList.add('holiday-row');
                if (isSunday) tr.classList.add('sunday-row');
                if (isSaturday) tr.classList.add('saturday-row');

                tr.innerHTML = `
                    <td class="cell-day">
                        <span class="day-name">${capitalizeFirst(dayName)}</span>
                        <span class="day-date">${dateDisplay}</span>
                        <span class="merged-employee-badge" style="background:${color}20; color:${color}; border: 1px solid ${color}40;">${empName}</span>
                        ${holiday ? `<span class="holiday-badge" title="${holiday.name}">🏴</span>` : ''}
                    </td>
                    <td class="cell-time">${entry.start || '-'}</td>
                    <td class="cell-time">${entry.end || '-'}</td>
                    <td class="cell-break">${entry.breakDuration || 0} min</td>
                    <td class="cell-hours has-hours">${FrenchRules.formatHours(hoursWorked)}</td>
                `;
                tbody.appendChild(tr);
            }
        }

        // Show merged results
        updateMergedResults(byEmployee);
    }

    function updateMergedResults(byEmployee) {
        const summaryEl = document.getElementById('summary-panel');
        const weeklyEl = document.getElementById('weekly-breakdown');
        const payDetailEl = document.getElementById('pay-detail-panel');

        let grandTotalHours = 0;
        let grandTotalPay = 0;
        let summaryCards = '';

        const employeeNames = Object.keys(byEmployee);

        for (let empIdx = 0; empIdx < employeeNames.length; empIdx++) {
            const empName = employeeNames[empIdx];
            const empData = byEmployee[empName];
            const color = EMPLOYEE_COLORS[empIdx % EMPLOYEE_COLORS.length];
            const hourlyRate = FrenchRules.calculateHourlyRate(empData.salary, empData.contractBase);
            const results = FrenchRules.processEntries(empData.entries, hourlyRate, empData.contractBase);

            grandTotalHours += results.totalHours;
            if (results.totalPay) grandTotalPay += results.totalPay.total;

            summaryCards += `
                <div class="merged-employee-card" style="border-left: 3px solid ${color};">
                    <div class="merged-card-header">
                        <span class="merged-card-name" style="color:${color}">${empName}</span>
                        <span class="merged-card-hours">${FrenchRules.formatHours(results.totalHours)}</span>
                    </div>
                    <div class="merged-card-details">
                        <span>Heures sup: ${FrenchRules.formatHours(results.totalOvertime)}</span>
                        ${results.totalPay ? `<span>Brut: ${results.totalPay.total.toFixed(2)} €</span>` : ''}
                    </div>
                </div>`;
        }

        summaryEl.innerHTML = `
            <div class="merged-summary">
                <div class="merged-grand-total">
                    <span class="merged-total-label">Total tous employés</span>
                    <span class="merged-total-hours">${FrenchRules.formatHours(grandTotalHours)}</span>
                    ${grandTotalPay > 0 ? `<span class="merged-total-pay">${grandTotalPay.toFixed(2)} €</span>` : ''}
                </div>
                <div class="merged-cards">${summaryCards}</div>
            </div>`;

        weeklyEl.innerHTML = '';
        payDetailEl.style.display = 'none';
    }

    // --- View switching ---
    function switchView() {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.view-btn[data-view="${state.viewMode}"]`)?.classList.add('active');

        const listView = document.getElementById('list-view');
        const gridView = document.getElementById('grid-view');
        if (listView) listView.style.display = state.viewMode === 'list' ? '' : 'none';
        if (gridView) gridView.style.display = state.viewMode === 'grid' ? '' : 'none';

        if (state.viewMode === 'grid') {
            renderGridView();
        }
    }

    // --- Theme ---
    function toggleTheme() {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme();
        API.saveSettings({ theme: state.theme }).catch(() => { });
    }

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', state.theme);
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            const sunIcon = btn.querySelector('.sun-icon');
            const moonIcon = btn.querySelector('.moon-icon');
            if (sunIcon) sunIcon.style.display = state.theme === 'dark' ? 'none' : 'block';
            if (moonIcon) moonIcon.style.display = state.theme === 'dark' ? 'block' : 'none';
        }
    }

    // --- Render entries table ---
    function renderEntries() {
        if (state.mergedView) return; // Don't render normal entries in merged mode

        const tbody = document.getElementById('entries-body');
        tbody.innerHTML = '';

        state.entries.forEach((entry, index) => {
            const date = parseDateLocal(entry.date);
            const dayName = date.toLocaleDateString('fr-FR', { weekday: 'short' });
            const dateDisplay = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            const holiday = FrenchRules.isPublicHoliday(date);
            const isSunday = date.getDay() === 0;
            const isSaturday = date.getDay() === 6;
            const hoursWorked = FrenchRules.calculateDailyHours(entry);

            const tr = document.createElement('tr');
            if (holiday) tr.classList.add('holiday-row');
            if (isSunday) tr.classList.add('sunday-row');
            if (isSaturday) tr.classList.add('saturday-row');

            // Week separator
            if (index > 0 && date.getDay() === 1) {
                tr.classList.add('week-start');
            }

            // Off day: no hours entered
            const isOff = !entry.start && !entry.end;
            if (isOff) tr.classList.add('day-off-row');

            tr.innerHTML = `
                ${state.quickMode ? `
                <td class="cell-check">
                    <label class="day-checkbox">
                        <input type="checkbox" data-index="${index}" class="quick-check"
                            ${(entry.start && entry.end) ? 'checked' : ''}>
                        <span class="checkmark"></span>
                    </label>
                </td>` : ''}
                <td class="cell-day">
                    <span class="day-name">${capitalizeFirst(dayName)}</span>
                    <span class="day-date">${dateDisplay}</span>
                    ${holiday ? `<span class="holiday-badge" title="${holiday.name}">🏴 ${holiday.name}</span>` : ''}
                </td>
                <td class="cell-time">
                    <input type="text" value="${entry.start}" data-index="${index}" data-field="start"
                        class="time-input" placeholder="HH:MM" maxlength="5" ${state.quickMode ? 'tabindex="-1"' : ''}>
                </td>
                <td class="cell-time">
                    <input type="text" value="${entry.end}" data-index="${index}" data-field="end"
                        class="time-input" placeholder="HH:MM" maxlength="5" ${state.quickMode ? 'tabindex="-1"' : ''}>
                </td>
                <td class="cell-break">
                    <div class="break-input-wrapper">
                        <input type="number" value="${entry.breakDuration || 0}" data-index="${index}" data-field="breakDuration"
                            class="break-input" min="0" max="480" step="5" title="Pause déjeuner (minutes)" ${state.quickMode ? 'tabindex="-1"' : ''}>
                        <span class="break-unit">min</span>
                    </div>
                </td>
                <td class="cell-hours ${hoursWorked > 0 ? 'has-hours' : ''}">
                    ${hoursWorked > 0 ? FrenchRules.formatHours(hoursWorked) : '-'}
                </td>
                <td class="cell-reset">
                    ${hoursWorked > 0 ? `<button class="btn-reset-row" data-index="${index}" title="Remettre à zéro">✕</button>` : ''}
                </td>
            `;

            // Attach input handlers
            tr.querySelectorAll('input.time-input').forEach(input => {
                input.addEventListener('blur', (e) => {
                    autoCompleteTime(e);
                    handleEntryChange(e);
                });
            });
            tr.querySelectorAll('input.break-input').forEach(input => {
                input.addEventListener('change', handleEntryChange);
                input.addEventListener('input', handleEntryChange);
            });

            // Quick mode checkbox handler
            const checkbox = tr.querySelector('.quick-check');
            if (checkbox) {
                checkbox.addEventListener('change', handleQuickCheck);
            }

            // Reset button handler
            const resetBtn = tr.querySelector('.btn-reset-row');
            if (resetBtn) {
                resetBtn.addEventListener('click', (e) => {
                    const idx = parseInt(e.target.dataset.index);
                    state.entries[idx].start = '';
                    state.entries[idx].end = '';
                    state.entries[idx].breakDuration = 0;
                    renderEntries();
                    updateResults();
                    scheduleAutoSave();
                });
            }

            tbody.appendChild(tr);
        });

        // Also render grid if in grid mode
        if (state.viewMode === 'grid') {
            renderGridView();
        }
    }

    // --- Render grid view ---
    function renderGridView() {
        const grid = document.getElementById('weeks-grid');
        if (!grid) return;
        grid.innerHTML = '';

        // Group entries by ISO week
        const weeks = [];
        let currentWeek = null;

        state.entries.forEach((entry, index) => {
            const date = parseDateLocal(entry.date);
            const dow = date.getDay();
            if (!currentWeek || dow === 1) {
                currentWeek = { entries: [], startDate: date };
                weeks.push(currentWeek);
            }
            currentWeek.entries.push({ ...entry, globalIndex: index, dateObj: date });
        });

        weeks.forEach((week) => {
            const weekCard = document.createElement('div');
            weekCard.className = 'week-grid-card';

            const firstDay = week.startDate;
            const lastDay = week.entries[week.entries.length - 1].dateObj;
            const weekLabel = `${firstDay.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — ${lastDay.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;
            const weekTotal = week.entries.reduce((sum, e) => sum + FrenchRules.calculateDailyHours(e), 0);

            weekCard.innerHTML = `
            <div class="wg-header">
                <span class="wg-label">${weekLabel}</span>
                <span class="wg-total ${weekTotal > 35 ? 'has-overtime' : ''}">${FrenchRules.formatHours(weekTotal)}</span>
            </div>
            <div class="wg-days"></div>
        `;

            const daysContainer = weekCard.querySelector('.wg-days');

            week.entries.forEach(entry => {
                const date = entry.dateObj;
                const dayName = date.toLocaleDateString('fr-FR', { weekday: 'short' });
                const dateNum = date.toLocaleDateString('fr-FR', { day: '2-digit' });
                const holiday = FrenchRules.isPublicHoliday(date);
                const isSunday = date.getDay() === 0;
                const isSaturday = date.getDay() === 6;
                const hoursWorked = FrenchRules.calculateDailyHours(entry);
                const hasHours = entry.start && entry.end;

                const dayRow = document.createElement('div');
                dayRow.className = 'wg-day';
                if (holiday) dayRow.classList.add('wg-holiday');
                if (isSunday) dayRow.classList.add('wg-sunday');
                if (isSaturday) dayRow.classList.add('wg-saturday');
                if (hasHours) dayRow.classList.add('wg-active');
                if (!hasHours) dayRow.classList.add('wg-off');

                if (state.quickMode) {
                    dayRow.innerHTML = `
                    <label class="wg-check-label">
                        <input type="checkbox" class="wg-check" data-index="${entry.globalIndex}" ${hasHours ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        <span class="wg-day-name">${capitalizeFirst(dayName)}</span>
                        <span class="wg-day-num">${dateNum}</span>
                        ${holiday ? '<span class="wg-badge" title="' + holiday.name + '">🏴</span>' : ''}
                        <span class="wg-hours">${hoursWorked > 0 ? FrenchRules.formatHours(hoursWorked) : ''}</span>
                    </label>
                `;
                    const cb = dayRow.querySelector('.wg-check');
                    cb.addEventListener('change', (e) => {
                        const idx = parseInt(e.target.dataset.index);
                        if (e.target.checked) {
                            state.entries[idx].start = state.quickTemplate.start;
                            state.entries[idx].end = state.quickTemplate.end;
                            state.entries[idx].breakDuration = state.quickTemplate.breakDuration;
                        } else {
                            state.entries[idx].start = '';
                            state.entries[idx].end = '';
                            state.entries[idx].breakDuration = 0;
                        }
                        scheduleAutoSave();
                        renderEntries();
                        updateResults();
                    });
                } else {
                    dayRow.innerHTML = `
                    <span class="wg-day-name">${capitalizeFirst(dayName)}</span>
                    <span class="wg-day-num">${dateNum}</span>
                    ${holiday ? '<span class="wg-badge" title="' + holiday.name + '">🏴</span>' : ''}
                    <input type="text" class="wg-time-input" value="${entry.start}" data-index="${entry.globalIndex}" data-field="start" placeholder="HH:MM" maxlength="5">
                    <span class="wg-sep">→</span>
                    <input type="text" class="wg-time-input" value="${entry.end}" data-index="${entry.globalIndex}" data-field="end" placeholder="HH:MM" maxlength="5">
                    <input type="number" class="wg-break-input" value="${entry.breakDuration || 0}" data-index="${entry.globalIndex}" data-field="breakDuration" min="0" max="480" step="5" title="Pause déjeuner (minutes)">
                    <span class="wg-hours">${hoursWorked > 0 ? FrenchRules.formatHours(hoursWorked) : '-'}</span>
                    ${hoursWorked > 0 ? `<button class="btn-reset-row wg-reset" data-index="${entry.globalIndex}" title="Remettre à zéro">✕</button>` : ''}
                `;
                    dayRow.querySelectorAll('.wg-time-input').forEach(input => {
                        input.addEventListener('blur', (e) => {
                            autoCompleteTime(e);
                            handleEntryChange(e);
                        });
                    });
                    dayRow.querySelectorAll('.wg-break-input').forEach(input => {
                        input.addEventListener('change', handleEntryChange);
                    });
                    const resetBtn = dayRow.querySelector('.wg-reset');
                    if (resetBtn) {
                        resetBtn.addEventListener('click', (e) => {
                            const idx = parseInt(e.target.dataset.index);
                            state.entries[idx].start = '';
                            state.entries[idx].end = '';
                            state.entries[idx].breakDuration = 0;
                            renderEntries();
                            updateResults();
                            scheduleAutoSave();
                        });
                    }
                }

                daysContainer.appendChild(dayRow);
            });

            grid.appendChild(weekCard);
        });
    }

    function handleEntryChange(e) {
        const index = parseInt(e.target.dataset.index);
        const field = e.target.dataset.field;
        const value = field === 'breakDuration' ? parseInt(e.target.value) || 0 : e.target.value;

        state.entries[index][field] = value;
        scheduleAutoSave();
        renderEntries();
        updateResults();
    }

    // Auto-complete time: "10" → "10:00", "9" → "09:00", "10:3" → "10:30"
    function autoCompleteTime(e) {
        const input = e.target;
        let val = input.value.trim();
        if (!val) return;

        let formatted = null;

        if (/^\d{1,2}$/.test(val)) {
            const h = parseInt(val, 10);
            if (h >= 0 && h <= 23) formatted = h.toString().padStart(2, '0') + ':00';
        } else if (/^\d{3,4}$/.test(val)) {
            let h, m;
            if (val.length === 3) { h = parseInt(val[0], 10); m = parseInt(val.slice(1), 10); }
            else { h = parseInt(val.slice(0, 2), 10); m = parseInt(val.slice(2), 10); }
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                formatted = h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
            }
        } else if (/^\d{1,2}:\d$/.test(val)) {
            const [hStr, mStr] = val.split(':');
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr + '0', 10);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                formatted = h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
            }
        } else if (/^\d{1,2}:\d{2}$/.test(val)) {
            const [hStr, mStr] = val.split(':');
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                formatted = h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
            }
        }

        if (formatted) input.value = formatted;
    }

    function capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    // --- Update hourly rate display ---
    function updateHourlyRateDisplay() {
        const display = document.getElementById('hourly-rate-display');
        const valueEl = document.getElementById('hourly-rate-value');
        if (!display || !valueEl) return;

        if (state.grossMonthlySalary > 0) {
            const rate = FrenchRules.calculateHourlyRate(state.grossMonthlySalary, state.contractBase);
            valueEl.textContent = `${rate.toFixed(2)} €/h`;
            display.style.display = 'flex';
        } else {
            display.style.display = 'none';
        }
    }

    // --- Get period label ---
    function getPeriodLabel() {
        const activeBtn = document.querySelector('.range-btn.active');
        const mode = activeBtn ? activeBtn.dataset.range : 'custom';
        const startStr = state.dateRange.start ? state.dateRange.start.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
        const endStr = state.dateRange.end ? state.dateRange.end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

        if (mode === 'week') return `Semaine du ${startStr} au ${endStr}`;
        if (mode === 'month') return state.dateRange.start ? state.dateRange.start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase()) : '';
        return `Du ${startStr} au ${endStr}`;
    }

    // --- Update results ---
    function updateResults() {
        if (state.mergedView) return; // Merged view has its own results

        const hourlyRate = FrenchRules.calculateHourlyRate(state.grossMonthlySalary, state.contractBase);
        const results = FrenchRules.processEntries(state.entries, hourlyRate, state.contractBase);
        state.currentResults = results;

        const baseLegalHours = state.contractBase === 39 ? 39 : 35;

        // Total hours
        document.getElementById('total-hours').textContent = FrenchRules.formatHours(results.totalHours);

        // Hide weekly breakdown — replaced by period recap
        const weeklyContainer = document.getElementById('weekly-breakdown');
        weeklyContainer.innerHTML = '';

        // Summary panel — period recap
        const summaryEl = document.getElementById('summary-panel');
        let summaryHTML = `
            <div class="period-recap">
                <h3 class="period-recap-title">${getPeriodLabel()}</h3>
                <div class="summary-grid">
                    <div class="summary-item">
                        <span class="summary-label">Heures totales</span>
                        <span class="summary-value">${FrenchRules.formatHours(results.totalHours)}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Heures supplémentaires</span>
                        <span class="summary-value overtime">${FrenchRules.formatHours(results.totalOvertime)}</span>
                    </div>`;

        if (results.totalSundayHours > 0) {
            summaryHTML += `
                    <div class="summary-item">
                        <span class="summary-label">Heures dimanche</span>
                        <span class="summary-value">${FrenchRules.formatHours(results.totalSundayHours)}</span>
                    </div>`;
        }
        if (results.totalHolidayHours > 0) {
            summaryHTML += `
                    <div class="summary-item">
                        <span class="summary-label">Heures jours fériés</span>
                        <span class="summary-value">${FrenchRules.formatHours(results.totalHolidayHours)}</span>
                    </div>`;
        }
        if (results.totalNightHours > 0) {
            summaryHTML += `
                    <div class="summary-item">
                        <span class="summary-label">Heures de nuit</span>
                        <span class="summary-value">${FrenchRules.formatHours(results.totalNightHours)}</span>
                    </div>`;
        }

        summaryHTML += `</div>`;

        // Pay detail as "pour info" — no gross amounts, just hourly rate hint
        if (results.totalPay && results.totalPay.total > 0) {
            summaryHTML += `
                <details class="pay-info-details">
                    <summary class="pay-info-summary">💰 Estimation rémunération (pour info)</summary>
                    <div class="pay-info-body">
                        <div class="pay-info-row">
                            <span>Heures normales (≤${baseLegalHours}h/sem)</span>
                            <span>${results.totalPay.regular.toFixed(2)} €</span>
                        </div>`;

            if (results.totalPay.overtime > 0) {
                summaryHTML += `
                        <div class="pay-info-row">
                            <span>Heures sup. (${FrenchRules.formatHours(results.totalOvertime)})</span>
                            <span>+${results.totalPay.overtime.toFixed(2)} €</span>
                        </div>`;
            }
            if (results.totalPay.sundayPremium > 0) {
                summaryHTML += `
                        <div class="pay-info-row">
                            <span>Majoration dimanche (${FrenchRules.formatHours(results.totalSundayHours)})</span>
                            <span>+${results.totalPay.sundayPremium.toFixed(2)} €</span>
                        </div>`;
            }
            if (results.totalPay.holidayPremium > 0) {
                summaryHTML += `
                        <div class="pay-info-row">
                            <span>Majoration férié (${FrenchRules.formatHours(results.totalHolidayHours)})</span>
                            <span>+${results.totalPay.holidayPremium.toFixed(2)} €</span>
                        </div>`;
            }

            summaryHTML += `
                        <div class="pay-info-row pay-info-total">
                            <span>Total brut estimé</span>
                            <span>${results.totalPay.total.toFixed(2)} €</span>
                        </div>
                    </div>
                </details>`;
        }

        summaryHTML += `</div>`;
        summaryEl.innerHTML = summaryHTML;

        // Hide old pay detail panel (now built into summary)
        const payDetailEl = document.getElementById('pay-detail-panel');
        payDetailEl.style.display = 'none';

        // Warnings
        const allWarnings = [];
        results.dailyResults.forEach(d => {
            d.warnings.forEach(w => {
                allWarnings.push({ ...w, context: `${d.dayName} ${parseDateLocal(d.date).toLocaleDateString('fr-FR')}` });
            });
        });
        results.weeklyResults.forEach(w => {
            w.warnings.forEach(warn => {
                allWarnings.push({ ...warn, context: w.week });
            });
        });

        const warningsEl = document.getElementById('warnings-panel');
        if (allWarnings.length > 0) {
            warningsEl.style.display = 'block';
            warningsEl.innerHTML = `
                <h3 class="warnings-title">⚠️ Alertes réglementaires</h3>
                ${allWarnings.map(w => `
                    <div class="alert alert-${w.type}">
                        <strong>${w.context}</strong> — ${w.message}
                    </div>`).join('')}
            `;
        } else {
            warningsEl.style.display = 'none';
        }
    }

    // --- Modal ---
    function openModal() {
        document.getElementById('add-employee-modal').classList.add('active');
        document.getElementById('new-employee-name').value = '';
        document.getElementById('new-employee-name').focus();
    }

    function closeModal() {
        document.getElementById('add-employee-modal').classList.remove('active');
    }

    // --- Clear ---
    function clearAllEntries() {
        if (!confirm('Effacer toutes les saisies de la période ?')) return;
        initEntries();
        scheduleAutoSave();
        showToast('Saisies effacées', 'info');
    }

    // --- Quick Mode ---
    function toggleQuickMode() {
        state.quickMode = document.getElementById('quick-mode-toggle').checked;
        const body = document.getElementById('quick-mode-body');
        const thCheck = document.getElementById('th-check');
        if (body) body.style.display = state.quickMode ? 'block' : 'none';
        if (thCheck) thCheck.style.display = state.quickMode ? '' : 'none';
        renderEntries();
    }

    function handleQuickCheck(e) {
        const index = parseInt(e.target.dataset.index);
        if (e.target.checked) {
            state.entries[index].start = state.quickTemplate.start;
            state.entries[index].end = state.quickTemplate.end;
            state.entries[index].breakDuration = state.quickTemplate.breakDuration;
        } else {
            state.entries[index].start = '';
            state.entries[index].end = '';
            state.entries[index].breakDuration = 0;
        }
        scheduleAutoSave();
        renderEntries();
        updateResults();
    }

    function quickSelectWeekdays() {
        state.entries.forEach((entry, index) => {
            const date = parseDateLocal(entry.date);
            const dow = date.getDay();
            if (dow >= 1 && dow <= 5) {
                state.entries[index].start = state.quickTemplate.start;
                state.entries[index].end = state.quickTemplate.end;
                state.entries[index].breakDuration = state.quickTemplate.breakDuration;
            }
        });
        scheduleAutoSave();
        renderEntries();
        updateResults();
    }

    // --- Share ---
    function shareResults() {
        if (!state.currentResults) {
            showToast('Aucun résultat à partager', 'warning');
            return;
        }

        const emp = state.employees.find(e => e.id === state.currentEmployeeId);
        const shareData = {
            entries: state.entries.filter(e => e.start && e.end),
            dateRange: {
                start: formatDate(state.dateRange.start),
                end: formatDate(state.dateRange.end)
            },
            grossMonthlySalary: state.grossMonthlySalary,
            contractBase: state.contractBase,
            employeeName: emp ? emp.name : ''
        };

        const encoded = btoa(encodeURIComponent(JSON.stringify(shareData)));
        const url = `${window.location.origin}?data=${encoded}`;

        navigator.clipboard.writeText(url).then(() => {
            showToast('Lien copié dans le presse-papier', 'success');
        }).catch(() => {
            prompt('Copiez ce lien:', url);
        });
    }

    // --- Load shared data ---
    function loadSharedData() {
        const params = new URLSearchParams(window.location.search);
        const data = params.get('data');
        if (!data) return;

        try {
            const decoded = JSON.parse(decodeURIComponent(atob(data)));
            if (decoded.dateRange) {
                state.dateRange.start = parseDateLocal(decoded.dateRange.start);
                state.dateRange.end = parseDateLocal(decoded.dateRange.end);
                document.getElementById('date-start').value = decoded.dateRange.start;
                document.getElementById('date-end').value = decoded.dateRange.end;
            }
            if (decoded.grossMonthlySalary) {
                state.grossMonthlySalary = decoded.grossMonthlySalary;
                document.getElementById('gross-salary').value = decoded.grossMonthlySalary;
            }
            if (decoded.contractBase) {
                state.contractBase = decoded.contractBase;
                document.querySelectorAll('.contract-btn').forEach(b => {
                    b.classList.toggle('active', parseInt(b.dataset.base) === state.contractBase);
                });
            }

            // Build entries from shared data
            initEntries();
            if (decoded.entries) {
                for (const se of decoded.entries) {
                    const idx = state.entries.findIndex(e => e.date === se.date);
                    if (idx >= 0) {
                        state.entries[idx] = { ...state.entries[idx], ...se };
                    }
                }
            }

            updateHourlyRateDisplay();
            renderEntries();
            updateResults();
            showToast('Données partagées chargées', 'info');

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {
            console.warn('Failed to load shared data:', e);
        }
    }

    // --- PDF Export ---
    // --- Print Planning ---
    function printPlanning() {
        // Validation: Must be a complete month
        if (!state.dateRange.start || !state.dateRange.end) {
            showToast("Veuillez définir une période d'abord", "warning");
            return;
        }

        const start = state.dateRange.start;
        const end = state.dateRange.end;

        // Check if start is 1st of month
        const isStartFirst = start.getDate() === 1;
        // Check if end is last day of same month and year
        const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
        const isEndLast = end.getDate() === lastDayOfMonth &&
            end.getMonth() === start.getMonth() &&
            end.getFullYear() === start.getFullYear();

        if (!isStartFirst || !isEndLast) {
            showToast("L'impression/PDF n'est permise que pour un mois complet.", "warning");
            return;
        }

        // 1. Remove existing print section if any
        const existing = document.getElementById('print-section');
        if (existing) existing.remove();

        // 2. Create print section container
        const printSection = document.createElement('div');
        printSection.id = 'print-section';

        // 3. Header: Employee + Period
        const empName = state.employees.find(e => e.id == state.currentEmployeeId)?.name || 'Employé';
        const periodLabel = getPeriodLabel();

        let html = `
            <div class="print-header">
                <h1>${empName}</h1>
                <h2>${periodLabel}</h2>
            </div>
        `;

        // 4. Entries Table (only days with hours)
        html += `
            <table class="print-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Début</th>
                        <th>Fin</th>
                        <th>Pause</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let hasEntries = false;
        // Sort entries by date
        const sortedEntries = [...state.entries].sort((a, b) => a.date.localeCompare(b.date));

        sortedEntries.forEach(entry => {
            const hours = FrenchRules.calculateDailyHours(entry);
            if (hours > 0) {
                hasEntries = true;
                const dateObj = parseDateLocal(entry.date);
                const dateStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                const isSunday = dateObj.getDay() === 0;
                const isHoliday = FrenchRules.isPublicHoliday(dateObj);

                let rowClass = '';
                if (isSunday) rowClass = 'print-row-sunday';
                if (isHoliday) rowClass = 'print-row-holiday';

                html += `
                    <tr class="${rowClass}">
                        <td>${capitalizeFirst(dateStr)} ${isHoliday ? '🏴' : ''}</td>
                        <td>${entry.start}</td>
                        <td>${entry.end}</td>
                        <td>${entry.breakDuration || 0}m</td>
                        <td><strong>${FrenchRules.formatHours(hours)}</strong></td>
                    </tr>
                `;
            }
        });

        if (!hasEntries) {
            html += `<tr><td colspan="5" style="text-align:center; padding: 20px;">Aucune heure saisie sur cette période.</td></tr>`;
        }

        html += `
                </tbody>
            </table>
        `;

        // 5. Summary Recap
        const results = state.currentResults; // already calculated by updateResults

        html += `
            <div class="print-summary">
                <div class="print-summary-item">
                    <span class="ps-label">Heures Totales</span>
                    <span class="ps-value">${FrenchRules.formatHours(results.totalHours)}</span>
                </div>
                <div class="print-summary-item">
                    <span class="ps-label">Heures Sup.</span>
                    <span class="ps-value">${FrenchRules.formatHours(results.totalOvertime)}</span>
                </div>
        `;

        if (results.totalSundayHours > 0) {
            html += `
                <div class="print-summary-item">
                    <span class="ps-label">Dimanche</span>
                    <span class="ps-value">${FrenchRules.formatHours(results.totalSundayHours)}</span>
                </div>
            `;
        }
        if (results.totalHolidayHours > 0) {
            html += `
                <div class="print-summary-item">
                    <span class="ps-label">Férié</span>
                    <span class="ps-value">${FrenchRules.formatHours(results.totalHolidayHours)}</span>
                </div>
            `;
        }

        html += `</div>`; // end print-summary

        printSection.innerHTML = html;
        document.body.appendChild(printSection);

        // 6. Trigger print
        window.print();

        // Cleanup after print (optional, but keeping it in DOM helps debug style issues if needed, usually we leave it hidden via CSS)
    }

    // --- Toast notifications ---
    function showToast(message, type = 'info') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Handle 401 unauthorized
    function handleUnauthorized() {
        window.location.href = '/login';
        return {};
    }

    // Public API
    return {
        init,
        openModal,
        closeModal
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
