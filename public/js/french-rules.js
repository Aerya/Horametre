/**
 * French Labor Law + CCN Jardineries & Graineteries (IDCC 1760)
 * Règles de calcul des heures, majorations, rémunération
 */

const FrenchRules = (() => {
    // --- Configuration ---
    const CONFIG = {
        weeklyLegalHours: 35,
        dailyMaxHours: 10,
        weeklyMaxHours: 48,
        weeklyAvgMaxHours: 44, // sur 12 semaines
        minDailyRestHours: 11,
        minWeeklyRestHours: 35, // 24 + 11
        mandatoryBreakAfterMinutes: 360, // 6h
        mandatoryBreakMinutes: 20,
        nightStart: 21, // 21:00
        nightEnd: 6,    // 06:00
        annualOvertimeQuota: 220,
        overtimeBrackets: [
            { from: 35, to: 43, rate: 1.25, label: 'Heures sup. 25%' },
            { from: 43, to: Infinity, rate: 1.50, label: 'Heures sup. 50%' }
        ],
        // CCN Jardineries & Graineteries (IDCC 1760)
        sundayPremiumRate: 0.50,    // +50% du taux horaire de base
        holidayPremiumRate: 1.00,   // +100% du taux horaire de base
        contractBases: {
            24: 104.00,  // heures mensuelles pour un contrat 24h
            32: 138.67,  // heures mensuelles pour un contrat 32h
            35: 151.67,  // heures mensuelles pour un contrat 35h
            39: 169.00   // heures mensuelles pour un contrat 39h (151.67 + 17.33)
        },
        structuralOvertimeHours39: 4  // heures structurelles 35→39h incluses dans le salaire 39h
    };

    // --- Sources légales ---
    const LEGAL_SOURCES = {
        codeduTravail: {
            label: 'Code du travail',
            url: 'https://www.legifrance.gouv.fr/codes/id/LEGITEXT000006072050/'
        },
        ccnJardineries: {
            label: 'CCN Jardineries & Graineteries (IDCC 1760)',
            url: 'https://www.legifrance.gouv.fr/conv_coll/id/KALICONT000005635938'
        },
        ccnPappers: {
            label: 'Fiche Pappers CCN Jardineries',
            url: 'https://www.pappers.fr/conventions-collectives/jardinerie'
        }
    };

    // --- Easter calculation (Computus - Anonymous Gregorian algorithm) ---
    function getEasterDate(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    }

    // --- French public holidays for a given year ---
    function getPublicHolidays(year) {
        const easter = getEasterDate(year);
        const easterMs = easter.getTime();
        const day = 86400000;

        return [
            { date: new Date(year, 0, 1), name: "Jour de l'An" },
            { date: new Date(easterMs + 1 * day), name: 'Lundi de Pâques' },
            { date: new Date(year, 4, 1), name: 'Fête du Travail' },
            { date: new Date(year, 4, 8), name: 'Victoire 1945' },
            { date: new Date(easterMs + 39 * day), name: 'Ascension' },
            { date: new Date(easterMs + 50 * day), name: 'Lundi de Pentecôte' },
            { date: new Date(year, 6, 14), name: 'Fête Nationale' },
            { date: new Date(year, 7, 15), name: 'Assomption' },
            { date: new Date(year, 10, 1), name: 'Toussaint' },
            { date: new Date(year, 10, 11), name: 'Armistice 1918' },
            { date: new Date(year, 11, 25), name: 'Noël' }
        ];
    }

    function isPublicHoliday(date) {
        const year = date.getFullYear();
        const holidays = getPublicHolidays(year);
        return holidays.find(h =>
            h.date.getFullYear() === date.getFullYear() &&
            h.date.getMonth() === date.getMonth() &&
            h.date.getDate() === date.getDate()
        );
    }

    function isSunday(date) {
        return date.getDay() === 0;
    }

    // --- Time parsing helpers ---
    function timeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    }

    function minutesToHours(minutes) {
        return Math.round((minutes / 60) * 100) / 100;
    }

    function formatHours(hours) {
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return `${h}h${m.toString().padStart(2, '0')}`;
    }

    function formatDuration(minutes) {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}h${m.toString().padStart(2, '0')}`;
    }

    // --- Calculate hourly rate from gross monthly salary ---
    function calculateHourlyRate(grossMonthlySalary, contractBase) {
        if (!grossMonthlySalary || grossMonthlySalary <= 0) return 0;
        const monthlyHours = CONFIG.contractBases[contractBase] || CONFIG.contractBases[35];
        return Math.round((grossMonthlySalary / monthlyHours) * 10000) / 10000;
    }

    // --- Calculate daily worked hours ---
    function calculateDailyHours(entry) {
        if (!entry.start || !entry.end) return 0;

        let startMin = timeToMinutes(entry.start);
        let endMin = timeToMinutes(entry.end);

        // Handle overnight shifts
        if (endMin <= startMin) {
            endMin += 1440; // +24h
        }

        let workedMinutes = endMin - startMin;

        // Subtract break
        const breakMin = parseInt(entry.breakDuration) || 0;
        workedMinutes -= breakMin;

        return Math.max(0, minutesToHours(workedMinutes));
    }

    // --- Calculate night hours for a given entry ---
    function calculateNightHours(entry) {
        if (!entry.start || !entry.end) return 0;

        let startMin = timeToMinutes(entry.start);
        let endMin = timeToMinutes(entry.end);

        if (endMin <= startMin) {
            endMin += 1440;
        }

        const nightStartMin = CONFIG.nightStart * 60; // 21:00 = 1260
        const nightEndMin = CONFIG.nightEnd * 60;     // 06:00 = 360

        let nightMinutes = 0;

        // Night period: 21:00 - 06:00 (next day)
        const nightP1Start = nightStartMin;
        const nightP1End = 1440;
        const nightP2Start = 0;
        const nightP2End = nightEndMin;

        // Overlap with period 1
        const overlap1Start = Math.max(startMin, nightP1Start);
        const overlap1End = Math.min(endMin, nightP1End);
        if (overlap1End > overlap1Start) nightMinutes += overlap1End - overlap1Start;

        // Overlap with period 2 (early morning)
        const overlap2Start = Math.max(startMin, nightP2Start);
        const overlap2End = Math.min(endMin, nightP2End);
        if (overlap2End > overlap2Start) nightMinutes += overlap2End - overlap2Start;

        // If shift crosses midnight (endMin > 1440), check next day's morning
        if (endMin > 1440) {
            const nextDayEnd = Math.min(endMin - 1440, nightEndMin * 60);
            nightMinutes += Math.max(0, nextDayEnd);
        }

        return minutesToHours(nightMinutes);
    }

    // --- Check warnings for a day ---
    function getDailyWarnings(entry, hoursWorked) {
        const warnings = [];

        if (hoursWorked > CONFIG.dailyMaxHours) {
            warnings.push({
                type: 'error',
                message: `Dépassement durée maximale quotidienne (${CONFIG.dailyMaxHours}h)`
            });
        }

        // Check mandatory break
        if (hoursWorked >= minutesToHours(CONFIG.mandatoryBreakAfterMinutes)) {
            const breakMin = parseInt(entry.breakDuration) || 0;
            if (breakMin < CONFIG.mandatoryBreakMinutes) {
                warnings.push({
                    type: 'warning',
                    message: `Pause obligatoire de ${CONFIG.mandatoryBreakMinutes} min après 6h de travail`
                });
            }
        }

        return warnings;
    }

    // --- Calculate weekly overtime breakdown ---
    function calculateOvertime(weeklyHours, contractBase = 35) {
        const threshold = (contractBase === 39) ? 39 : CONFIG.weeklyLegalHours;

        const result = {
            regularHours: 0,
            structuralHours: 0, // heures structurelles 35→39h (si base 39h)
            brackets: [],
            totalOvertime: 0,
            contractBase: contractBase
        };

        if (contractBase === 39) {
            // Base 39h: les heures 35→39 sont structurelles (incluses dans le salaire)
            const hoursUpTo35 = Math.min(weeklyHours, 35);
            const structuralHours = Math.min(Math.max(weeklyHours - 35, 0), 4);
            result.regularHours = hoursUpTo35;
            result.structuralHours = structuralHours;

            if (weeklyHours <= threshold) {
                return result;
            }

            // Au-delà de 39h = heures sup
            let remainingOvertime = weeklyHours - threshold;
            result.totalOvertime = remainingOvertime;

            // Brackets recalculés à partir de 39h
            const overtimeBrackets39 = [
                { from: 39, to: 43, rate: 1.25, label: 'Heures sup. 25% (>39h)' },
                { from: 43, to: Infinity, rate: 1.50, label: 'Heures sup. 50% (>43h)' }
            ];

            for (const bracket of overtimeBrackets39) {
                const bracketWidth = bracket.to - bracket.from;
                const hoursInBracket = Math.min(remainingOvertime, bracketWidth);

                if (hoursInBracket > 0) {
                    result.brackets.push({
                        label: bracket.label,
                        hours: Math.round(hoursInBracket * 100) / 100,
                        rate: bracket.rate,
                        multipliedHours: Math.round(hoursInBracket * bracket.rate * 100) / 100
                    });
                    remainingOvertime -= hoursInBracket;
                }
                if (remainingOvertime <= 0) break;
            }
        } else {
            // Base 35h: comportement standard
            if (weeklyHours <= CONFIG.weeklyLegalHours) {
                result.regularHours = weeklyHours;
                return result;
            }

            result.regularHours = CONFIG.weeklyLegalHours;
            let remainingOvertime = weeklyHours - CONFIG.weeklyLegalHours;
            result.totalOvertime = remainingOvertime;

            for (const bracket of CONFIG.overtimeBrackets) {
                const bracketWidth = bracket.to - bracket.from;
                const hoursInBracket = Math.min(remainingOvertime, bracketWidth);

                if (hoursInBracket > 0) {
                    result.brackets.push({
                        label: bracket.label,
                        hours: Math.round(hoursInBracket * 100) / 100,
                        rate: bracket.rate,
                        multipliedHours: Math.round(hoursInBracket * bracket.rate * 100) / 100
                    });
                    remainingOvertime -= hoursInBracket;
                }
                if (remainingOvertime <= 0) break;
            }
        }

        return result;
    }

    // --- Calculate pay for a week ---
    function calculatePay(weeklyHours, hourlyRate, contractBase = 35, sundayHours = 0, holidayHours = 0) {
        if (!hourlyRate || hourlyRate <= 0) return null;

        const overtime = calculateOvertime(weeklyHours, contractBase);

        // Base pay
        let basePay = overtime.regularHours * hourlyRate;

        // Structural hours pay (39h base: already included in salary but we show them)
        let structuralPay = 0;
        if (contractBase === 39 && overtime.structuralHours > 0) {
            // Structurelles à 125% (inclus dans le salaire brut 39h)
            structuralPay = overtime.structuralHours * hourlyRate * 1.25;
            basePay += structuralPay;
        }

        // Overtime pay
        let overtimePay = 0;
        for (const bracket of overtime.brackets) {
            overtimePay += bracket.hours * hourlyRate * bracket.rate;
        }

        // Sunday premium (CCN Jardineries: +50%)
        const sundayPremium = sundayHours * hourlyRate * CONFIG.sundayPremiumRate;

        // Holiday premium (CCN Jardineries: +100%)
        const holidayPremium = holidayHours * hourlyRate * CONFIG.holidayPremiumRate;

        const totalPay = basePay + overtimePay + sundayPremium + holidayPremium;

        return {
            regularPay: Math.round(basePay * 100) / 100,
            structuralPay: Math.round(structuralPay * 100) / 100,
            overtimePay: Math.round(overtimePay * 100) / 100,
            sundayHours: Math.round(sundayHours * 100) / 100,
            sundayPremium: Math.round(sundayPremium * 100) / 100,
            holidayHours: Math.round(holidayHours * 100) / 100,
            holidayPremium: Math.round(holidayPremium * 100) / 100,
            totalPay: Math.round(totalPay * 100) / 100,
            breakdown: overtime
        };
    }

    // --- Get weekly warnings ---
    function getWeeklyWarnings(weeklyHours) {
        const warnings = [];

        if (weeklyHours > CONFIG.weeklyMaxHours) {
            warnings.push({
                type: 'error',
                message: `Dépassement durée maximale hebdomadaire (${CONFIG.weeklyMaxHours}h)`
            });
        } else if (weeklyHours > CONFIG.weeklyAvgMaxHours) {
            warnings.push({
                type: 'warning',
                message: `Attention : ${CONFIG.weeklyAvgMaxHours}h max en moyenne sur 12 semaines`
            });
        }

        return warnings;
    }

    // --- Process a full period ---
    function processEntries(entries, hourlyRate, contractBase = 35) {
        const dailyResults = [];
        let totalHours = 0;
        let totalNightHours = 0;
        let totalSundayHours = 0;
        let totalHolidayHours = 0;
        const weeklyHoursMap = {};
        const weeklySundayMap = {};
        const weeklyHolidayMap = {};

        for (const entry of entries) {
            const date = new Date(entry.date);
            const hoursWorked = calculateDailyHours(entry);
            const nightHours = calculateNightHours(entry);
            const holiday = isPublicHoliday(date);
            const sunday = isSunday(date);
            const warnings = getDailyWarnings(entry, hoursWorked);

            // Get ISO week number for grouping
            const weekKey = getISOWeek(date);
            if (!weeklyHoursMap[weekKey]) weeklyHoursMap[weekKey] = 0;
            if (!weeklySundayMap[weekKey]) weeklySundayMap[weekKey] = 0;
            if (!weeklyHolidayMap[weekKey]) weeklyHolidayMap[weekKey] = 0;

            weeklyHoursMap[weekKey] += hoursWorked;

            // Track sunday and holiday hours
            if (sunday && hoursWorked > 0) {
                weeklySundayMap[weekKey] += hoursWorked;
                totalSundayHours += hoursWorked;
            }
            if (holiday && hoursWorked > 0) {
                weeklyHolidayMap[weekKey] += hoursWorked;
                totalHolidayHours += hoursWorked;
            }

            totalHours += hoursWorked;
            totalNightHours += nightHours;

            dailyResults.push({
                date: entry.date,
                dayName: date.toLocaleDateString('fr-FR', { weekday: 'long' }),
                hoursWorked,
                nightHours,
                isHoliday: !!holiday,
                holidayName: holiday ? holiday.name : null,
                isSunday: sunday,
                warnings,
                start: entry.start,
                end: entry.end,
                breakDuration: entry.breakDuration
            });
        }

        // Weekly breakdown
        const weeklyResults = [];
        let cumulativeOvertime = 0;

        for (const [weekKey, hours] of Object.entries(weeklyHoursMap)) {
            const sundayH = weeklySundayMap[weekKey] || 0;
            const holidayH = weeklyHolidayMap[weekKey] || 0;
            const overtime = calculateOvertime(hours, contractBase);
            const warnings = getWeeklyWarnings(hours);
            const pay = calculatePay(hours, hourlyRate, contractBase, sundayH, holidayH);

            cumulativeOvertime += overtime.totalOvertime;

            weeklyResults.push({
                week: weekKey,
                totalHours: Math.round(hours * 100) / 100,
                overtime,
                warnings,
                pay,
                sundayHours: Math.round(sundayH * 100) / 100,
                holidayHours: Math.round(holidayH * 100) / 100,
                cumulativeOvertime: Math.round(cumulativeOvertime * 100) / 100
            });
        }

        // Total pay across all weeks
        let totalPay = null;
        if (hourlyRate > 0) {
            totalPay = {
                regular: 0,
                structural: 0,
                overtime: 0,
                sundayPremium: 0,
                holidayPremium: 0,
                total: 0
            };
            for (const w of weeklyResults) {
                if (w.pay) {
                    totalPay.regular += w.pay.regularPay;
                    totalPay.structural += w.pay.structuralPay;
                    totalPay.overtime += w.pay.overtimePay;
                    totalPay.sundayPremium += w.pay.sundayPremium;
                    totalPay.holidayPremium += w.pay.holidayPremium;
                    totalPay.total += w.pay.totalPay;
                }
            }
            totalPay.regular = Math.round(totalPay.regular * 100) / 100;
            totalPay.structural = Math.round(totalPay.structural * 100) / 100;
            totalPay.overtime = Math.round(totalPay.overtime * 100) / 100;
            totalPay.sundayPremium = Math.round(totalPay.sundayPremium * 100) / 100;
            totalPay.holidayPremium = Math.round(totalPay.holidayPremium * 100) / 100;
            totalPay.total = Math.round(totalPay.total * 100) / 100;
        }

        return {
            dailyResults,
            weeklyResults,
            totalHours: Math.round(totalHours * 100) / 100,
            totalNightHours: Math.round(totalNightHours * 100) / 100,
            totalSundayHours: Math.round(totalSundayHours * 100) / 100,
            totalHolidayHours: Math.round(totalHolidayHours * 100) / 100,
            totalOvertime: Math.round(cumulativeOvertime * 100) / 100,
            totalPay,
            contractBase
        };
    }

    // --- ISO week number ---
    function getISOWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-S${weekNo.toString().padStart(2, '0')}`;
    }

    // Public API
    return {
        CONFIG,
        LEGAL_SOURCES,
        getPublicHolidays,
        isPublicHoliday,
        calculateDailyHours,
        calculateNightHours,
        calculateHourlyRate,
        calculateOvertime,
        calculatePay,
        processEntries,
        getDailyWarnings,
        getWeeklyWarnings,
        getISOWeek,
        formatHours,
        formatDuration,
        timeToMinutes,
        minutesToHours
    };
})();
