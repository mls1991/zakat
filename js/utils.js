// 公共工具函数 — index.html 和 result.html 共用

function sanitizeNumber(raw) {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n);
}

function roundMoney(num) {
    return Math.round(num * 100) / 100;
}

function fmt(n) {
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safeAdd(...nums) {
    return nums.reduce((sum, num) => roundMoney(sum + num), 0);
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('localStorage 写入失败:', e.message);
    }
}
