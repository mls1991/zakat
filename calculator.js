/* Shared calculation and draft migration, independent of the browser. */
(function (root) {
    'use strict';
    const groups = {
        asset: ['cash', 'tradeGoods', 'stocks', 'realEstate', 'receivables'],
        debt: ['personalDebt', 'mortgage', 'carLoan', 'creditCard', 'otherDebt', 'annualBasicExpenses'],
        nisab: ['nisabThreshold']
    };
    const fields = [...groups.asset, ...groups.debt, ...groups.nisab, 'goldWeight', 'silverWeight', 'goldPrice', 'silverPrice'];
    const moneyFields = [...groups.asset, ...groups.debt, ...groups.nisab, 'goldPrice', 'silverPrice'];
    const number = raw => {
        const value = Number(raw);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const factor = unit => unit === 'wan' ? 10000 : 1;
    const fmt = value => number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function emptyDraft() {
        return {
            schemaVersion: 2,
            values: Object.fromEntries(fields.map(id => [id, 0])),
            units: { asset: 'yuan', debt: 'yuan', nisab: 'yuan' },
            hawlConfirmed: false,
            prices: { gold: { source: 'live', updatedAt: null }, silver: { source: 'live', updatedAt: null } },
            nisabSource: 'manual'
        };
    }

    function restoreDraft(raw) {
        const draft = emptyDraft();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return draft;
        const canonical = raw.schemaVersion === 2 && raw.values && typeof raw.values === 'object';
        for (const group of Object.keys(groups)) {
            const unit = canonical ? raw.units?.[group] : raw[group + 'Unit'];
            draft.units[group] = unit === 'wan' ? 'wan' : 'yuan';
        }
        for (const id of fields) {
            let value = number(canonical ? raw.values[id] : raw[id]);
            // Version 1 stored displayed amounts. Version 2 always stores yuan.
            if (!canonical) {
                const group = Object.keys(groups).find(group => groups[group].includes(id));
                if (group) value *= factor(draft.units[group]);
            }
            draft.values[id] = moneyFields.includes(id) ? roundMoney(value) : value;
        }
        draft.hawlConfirmed = raw.hawlConfirmed === true;
        for (const metal of ['gold', 'silver']) {
            const saved = canonical ? raw.prices?.[metal] : null;
            // Preserve existing prices when migrating: their origin is unknown.
            draft.prices[metal] = {
                source: saved?.source === 'manual' || (!canonical && draft.values[metal + 'Price'] > 0) ? 'manual' : 'live',
                updatedAt: typeof saved?.updatedAt === 'string' ? saved.updatedAt : null
            };
        }
        draft.nisabSource = canonical && raw.nisabSource === 'silverReference' ? 'silverReference' : 'manual';
        return draft;
    }

    function calculate(values, hawlConfirmed) {
        const v = Object.fromEntries(fields.map(id => [id, number(values[id])]));
        const add = ids => ids.reduce((sum, id) => roundMoney(sum + v[id]), 0);
        const goldValue = roundMoney(v.goldWeight * v.goldPrice);
        const silverValue = roundMoney(v.silverWeight * v.silverPrice);
        const totalAssets = roundMoney(add(groups.asset) + goldValue + silverValue);
        const totalDebts = add(groups.debt);
        const netWealth = roundMoney(totalAssets - totalDebts);
        const nisabThreshold = roundMoney(v.nisabThreshold);
        const isAboveNisab = nisabThreshold > 0 && netWealth >= nisabThreshold;
        return {
            schemaVersion: 1, hawlConfirmed: !!hawlConfirmed,
            goldPrice: v.goldPrice, silverPrice: v.silverPrice, nisabThreshold,
            assets: { ...Object.fromEntries(groups.asset.map(id => [id, roundMoney(v[id])])), goldWeight: v.goldWeight, silverWeight: v.silverWeight, goldValue, silverValue },
            debts: Object.fromEntries(groups.debt.map(id => [id, roundMoney(v[id])])),
            totalAssets, totalDebts, netWealth, isAboveNisab,
            zakatDue: hawlConfirmed && isAboveNisab ? roundMoney(netWealth * 0.025) : 0
        };
    }

    const api = { groups, fields, moneyFields, number, roundMoney, factor, fmt, emptyDraft, restoreDraft, calculate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ZakatCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
