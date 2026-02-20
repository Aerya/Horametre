/**
 * Horamètre - Backend API
 * Node.js + Express + better-sqlite3
 */

const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'workhours.db');
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// --- Database setup ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        gross_monthly_salary REAL DEFAULT 0,
        contract_base INTEGER DEFAULT 35,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        start TEXT DEFAULT '',
        end TEXT DEFAULT '',
        break_duration INTEGER DEFAULT 0,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

// --- Middleware ---
app.use(express.json());

// Session middleware (always active for consistency)
app.use(session({
    secret: crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
}));

// Static files that don't require auth (CSS, JS, fonts)
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// --- Auth Routes ---
app.get('/login', (req, res) => {
    if (!AUTH_PASSWORD || req.session.authenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/auth/login', (req, res) => {
    if (!AUTH_PASSWORD) {
        return res.json({ success: true });
    }
    const { password } = req.body;
    if (password === AUTH_PASSWORD) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Mot de passe incorrect' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

app.get('/api/auth/status', (req, res) => {
    res.json({
        authEnabled: !!AUTH_PASSWORD,
        authenticated: !AUTH_PASSWORD || !!req.session.authenticated
    });
});

// --- Auth Middleware ---
function requireAuth(req, res, next) {
    // No password configured → no auth needed
    if (!AUTH_PASSWORD) return next();
    // Session valid
    if (req.session && req.session.authenticated) return next();
    // API calls → 401
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Non authentifié' });
    }
    // Page requests → redirect to login
    return res.redirect('/login');
}

// Protect everything below this point
app.use(requireAuth);

// Serve static files (after auth check)
app.use(express.static(path.join(__dirname, 'public')));

// --- Prepared statements ---
const stmts = {
    // Employees
    listEmployees: db.prepare(`
        SELECT e.*, COUNT(n.id) as entry_count
        FROM employees e
        LEFT JOIN entries n ON n.employee_id = e.id
        GROUP BY e.id
        ORDER BY e.name
    `),
    getEmployee: db.prepare('SELECT * FROM employees WHERE id = ?'),
    getEmployeeByName: db.prepare('SELECT * FROM employees WHERE name = ?'),
    createEmployee: db.prepare(`
        INSERT INTO employees (name, gross_monthly_salary, contract_base)
        VALUES (?, ?, ?)
    `),
    updateEmployee: db.prepare(`
        UPDATE employees
        SET name = ?, gross_monthly_salary = ?, contract_base = ?, updated_at = datetime('now')
        WHERE id = ?
    `),
    deleteEmployee: db.prepare('DELETE FROM employees WHERE id = ?'),

    // Entries
    getEntries: db.prepare(`
        SELECT * FROM entries
        WHERE employee_id = ? AND date >= ? AND date <= ?
        ORDER BY date
    `),
    upsertEntry: db.prepare(`
        INSERT INTO entries (employee_id, date, start, end, break_duration)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, date) DO UPDATE SET
            start = excluded.start,
            end = excluded.end,
            break_duration = excluded.break_duration
    `),
    deleteEntriesForPeriod: db.prepare(`
        DELETE FROM entries WHERE employee_id = ? AND date >= ? AND date <= ?
    `),
    getAllEntries: db.prepare(`
        SELECT n.*, e.name as employee_name, e.gross_monthly_salary, e.contract_base
        FROM entries n
        JOIN employees e ON e.id = n.employee_id
        WHERE n.date >= ? AND n.date <= ?
        ORDER BY n.date, e.name
    `),

    // Settings
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
};

// --- API Routes ---

// == Employees ==
app.get('/api/employees', (req, res) => {
    try {
        const employees = stmts.listEmployees.all();
        res.json(employees);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/employees', (req, res) => {
    try {
        const { name, gross_monthly_salary = 0, contract_base = 35 } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Le nom est requis' });
        }

        // Check if already exists
        const existing = stmts.getEmployeeByName.get(name.trim());
        if (existing) {
            return res.status(409).json({ error: 'Un employé avec ce nom existe déjà', employee: existing });
        }

        const result = stmts.createEmployee.run(name.trim(), gross_monthly_salary, contract_base);
        const employee = stmts.getEmployee.get(result.lastInsertRowid);
        res.status(201).json(employee);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/employees/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, gross_monthly_salary, contract_base } = req.body;

        const existing = stmts.getEmployee.get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Employé non trouvé' });
        }

        stmts.updateEmployee.run(
            name ?? existing.name,
            gross_monthly_salary ?? existing.gross_monthly_salary,
            contract_base ?? existing.contract_base,
            id
        );

        const employee = stmts.getEmployee.get(id);
        res.json(employee);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/employees/:id', (req, res) => {
    try {
        const { id } = req.params;
        const existing = stmts.getEmployee.get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Employé non trouvé' });
        }
        stmts.deleteEmployee.run(id);
        res.json({ success: true, deleted: existing.name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// == Entries ==
app.get('/api/employees/:id/entries', (req, res) => {
    try {
        const { id } = req.params;
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'start et end sont requis' });
        }
        const entries = stmts.getEntries.all(id, start, end);
        res.json(entries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/employees/:id/entries', (req, res) => {
    try {
        const { id } = req.params;
        const { entries } = req.body;

        if (!Array.isArray(entries)) {
            return res.status(400).json({ error: 'entries doit être un tableau' });
        }

        const existing = stmts.getEmployee.get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Employé non trouvé' });
        }

        const upsertMany = db.transaction((items) => {
            for (const entry of items) {
                stmts.upsertEntry.run(
                    id,
                    entry.date,
                    entry.start || '',
                    entry.end || '',
                    entry.breakDuration || entry.break_duration || 0
                );
            }
        });

        upsertMany(entries);
        res.json({ success: true, count: entries.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// == All entries (merged view) ==
app.get('/api/entries/all', (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ error: 'start et end sont requis' });
        }
        const entries = stmts.getAllEntries.all(start, end);
        res.json(entries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// == Settings ==
app.get('/api/settings', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM settings').all();
        const settings = {};
        for (const row of rows) {
            try {
                settings[row.key] = JSON.parse(row.value);
            } catch {
                settings[row.key] = row.value;
            }
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings', (req, res) => {
    try {
        const updates = req.body;
        const updateMany = db.transaction((items) => {
            for (const [key, value] of Object.entries(items)) {
                stmts.setSetting.run(key, JSON.stringify(value));
            }
        });
        updateMany(updates);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check (no auth)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Shutting down...');
    db.close();
    process.exit(0);
});

// Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Horamètre server running on port ${PORT}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`Auth: ${AUTH_PASSWORD ? 'ENABLED' : 'DISABLED (no AUTH_PASSWORD set)'}`);
});
