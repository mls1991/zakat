# 天课计算器 v2 — 改进方案

## 概述

按照「投入小、回报大」的原则，将改进分为 3 个阶段，共 12 项任务。
每阶段内的任务相互独立，可并行执行。

---

## 阶段一：架构整理（基础工程） ✅ 已完成

> 不改变任何功能，只做代码组织优化。完成后所有后续改动都更容易。

### 1.1 拆分 JS 到独立文件 ✅

**目标**: 消除 index.html / result.html 中的内联 `<script>`，提升可维护性和浏览器缓存效率。

**产出文件**:
```
js/
├── utils.js        # sanitizeNumber, roundMoney, fmt 等公共函数
├── app.js          # index.html 的全部逻辑
└── result.js       # result.html 的全部逻辑
```

**具体步骤**:

1. 创建 `js/utils.js`，提取两个页面共用的函数：
   - `sanitizeNumber(raw)` — 输入清洗
   - `roundMoney(num)` — 金额取整
   - `fmt(n)` — 数字格式化（当前仅在 result.html 中，但 app.js 未来也可能用）
   - `safeAdd(...nums)` — 安全累加

2. 创建 `js/app.js`，将 index.html 中 `<script>` 内的全部代码迁入：
   - 顶部 `import` 或直接引用 utils.js 中的函数（因为无构建工具，采用全局挂载方式）
   - 保持所有函数签名不变，确保 HTML 中 `onclick` 等绑定不需要修改

3. 创建 `js/result.js`，将 result.html 中 `<script>` 内的全部代码迁入

4. 修改 index.html：
   - 删除 `<script>...</script>` 块
   - 在 `</body>` 前添加：
     ```html
     <script src="js/utils.js"></script>
     <script src="js/app.js"></script>
     ```

5. 修改 result.html：
   - 删除 `<script>...</script>` 块
   - 在 `</body>` 前添加：
     ```html
     <script src="js/utils.js"></script>
     <script src="js/result.js"></script>
     ```

**验证**: 打开两个页面，所有功能（价格获取、单位切换、计算、结果展示）与改动前完全一致。

---

### 1.2 localStorage 写入加 try-catch 保护 ✅

**目标**: 防止 localStorage 满或被禁用时页面崩溃。

**修改位置**: `js/utils.js` 中新增安全存储函数

**具体实现**:
```javascript
function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('localStorage 写入失败:', e.message);
    }
}
```

**影响范围**:
- `app.js` 中 `saveDraft()` 的 `localStorage.setItem('zakatDraftV2', ...)`
- `app.js` 中 `calculateAndNavigate()` 的 `localStorage.setItem('zakatResultV2', ...)`

共 2 处调用替换为 `safeSetItem()`。

---

### 1.3 更新 README.md ✅

**修改内容**:
- 文件结构加入 `style.css` 和 `js/` 目录
- 目录名从 `zakat-v2/` 改为实际的项目根
- 补充 CNAME 自定义域名说明

---

## 阶段二：核心体验提升 ✅ 已完成

> 直接影响用户使用体验的功能改进。

### 2.1 一键自动填充起征点 ✅

**目标**: 用户获取银价后，可一键用 `612.36g × 当前银价` 自动计算起征点，省去手动计算。

**UI 变更**: 在起征点输入框下方、现有提示文字旁边，增加一个「自动计算」按钮。

**HTML 变更** (index.html 起征点卡片部分):
```html
<div class="note">
    哈乃斐学派通常以 612.36 克白银的市场价值为参考标准
    <button class="auto-calc-btn" id="autoNisabBtn" onclick="autoCalcNisab()">
        使用当前银价自动计算
    </button>
</div>
```

**JS 逻辑** (app.js):
```javascript
function autoCalcNisab() {
    const silverPrice = getVal('silverPrice');
    if (silverPrice <= 0) {
        showAlert('请先获取或填写白银价格，再自动计算起征点。');
        return;
    }
    const nisab = roundMoney(612.36 * silverPrice);
    // 根据当前单位换算
    const displayVal = nisabUnit === 'wan' ? nisab / 10000 : nisab;
    document.getElementById('nisabThreshold').value = displayVal;
    saveDraft();
}
```

**CSS 变更**: 新增 `.auto-calc-btn` 样式（小号链接按钮风格）。

---

### 2.2 Enter 键行为修正 ✅

**问题**: 当前 Enter 键全局绑定 `calculateAndNavigate()`，用户在输入框内按 Enter 会意外触发计算。

**修复方案**: 仅在用户焦点不在输入框内时响应 Enter，或完全移除全局 Enter 监听。

**修改** (app.js):
```javascript
// 修改前
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') calculateAndNavigate();
});

// 修改后
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'INPUT') {
        calculateAndNavigate();
    }
});
```

---

### 2.3 净资产为负时的 UI 处理 ✅

**问题**: 当债务 > 资产时，进度条显示 0% 但没有文字说明。

**修改位置**: `js/result.js` 的 `render()` 函数

**具体实现**: 当 `netWealth < 0` 时：
- 进度条下方显示提示文字：「您的净资产为负，无需缴纳天课」
- 净资产金额标红显示

**CSS 新增**:
```css
.net-wealth-negative {
    color: var(--danger);
}
```

---

### 2.4 价格获取增加节流 + 重试 ✅

**问题**: 用户可以反复点击「获取实时价格」导致请求堆积；失败后无重试。

**修改** (app.js):

1. **节流**: 在 `fetchPrices()` 开头加一个 30 秒冷却期：
```javascript
let lastFetchTime = 0;
const FETCH_COOLDOWN = 30000; // 30 秒

async function fetchPrices() {
    const now = Date.now();
    if (now - lastFetchTime < FETCH_COOLDOWN) {
        // 静默忽略，或显示提示
        return;
    }
    lastFetchTime = now;
    // ...原逻辑
}
```

2. **简单重试**: 失败时自动重试 1 次（间隔 2 秒）：
```javascript
// 在 catch 块中
} catch (err) {
    if (!isRetry) {
        setTimeout(() => fetchPrices(true), 2000);
        return;
    }
    // 显示错误...
}
```

---

## 阶段三：规范化与打磨 ✅ 已完成

> 提升项目专业度和可访问性。

### 3.1 添加 favicon ✅

**产出文件**: `favicon.svg`（月亮 + 星形 SVG 图标，与 header 风格一致）

**HTML 变更** (两个 html 文件的 `<head>` 中):
```html
<link rel="icon" href="favicon.svg" type="image/svg+xml">
```

---

### 3.2 添加 Open Graph 元标签 ✅

**修改位置**: 两个 html 文件的 `<head>`

**新增内容** (index.html):
```html
<meta property="og:title" content="天课计算器 · Zakat Calculator">
<meta property="og:description" content="基于哈乃斐学派的天课在线计算器，帮助穆斯林准确计算应缴天课金额">
<meta property="og:type" content="website">
<meta property="og:url" content="http://zakat.ayudanci.com/">
<meta property="og:locale" content="zh_CN">
```

---

### 3.3 可访问性 (a11y) 基础修复 ✅

**共 4 类改动**:

#### a. `<label>` 关联 `<input>`
所有 label 标签加 `for` 属性，指向对应 input 的 `id`：
```html
<!-- 修改前 -->
<label>每克黄金价格</label>
<input type="number" id="goldPrice" ...>

<!-- 修改后 -->
<label for="goldPrice">每克黄金价格</label>
<input type="number" id="goldPrice" ...>
```

影响范围：index.html 中约 15 个 `<label>` 标签。

#### b. 阿拉伯文标记语言和方向
```html
<!-- 修改前 -->
<div class="header-subtitle">حاسبة الزكاة</div>

<!-- 修改后 -->
<div class="header-subtitle" lang="ar" dir="rtl">حاسبة الزكاة</div>
```

```html
<!-- footer 同理 -->
<div class="footer-arabic" lang="ar" dir="rtl">الحمد لله</div>
```

影响范围：index.html 2 处，result.html 1 处。

#### c. SVG 图标添加 `aria-hidden`
装饰性 SVG 不应被屏幕阅读器朗读：
```html
<svg viewBox="0 0 24 24" aria-hidden="true">...</svg>
```

影响范围：所有页面中的装饰性 `<svg>` 标签（约 20 处）。

#### d. 单位切换按钮添加 `aria-label`
```html
<button class="unit-btn active" data-unit="yuan" aria-label="切换到元" onclick="switchUnit('asset','yuan')">元</button>
<button class="unit-btn" data-unit="wan" aria-label="切换到万元" onclick="switchUnit('asset','wan')">万元</button>
```

---

### 3.4 移动端输入优化 ✅

**修改位置**: index.html 中所有 `<input type="number">`

**变更**: 添加 `inputmode="decimal"` 属性，确保 iOS 弹出带小数点的数字键盘：
```html
<input type="number" id="cash" inputmode="decimal" ...>
```

影响范围：约 15 个 input 标签。

---

### 3.5 CSS 文字对比度修正 ✅

**问题**: `--text-muted: #8a8a9e` 在 `--ivory: #faf8f5` 背景上对比度约 3.4:1，未达 WCAG AA 标准（4.5:1）。

**修改**: 调深 muted 色值：
```css
/* 修改前 */
--text-muted: #8a8a9e;

/* 修改后 */
--text-muted: #6b6b7e;
```

新对比度约 4.92:1（相对于 `--ivory`），达到普通文字 WCAG AA 4.5:1 要求。

---

## 执行检查清单

| # | 任务 | 阶段 | 涉及文件 | 状态 |
|---|------|------|----------|------|
| 1.1 | 拆分 JS 到独立文件 | 一 | index.html, result.html, js/*.js | ✅ 已完成 |
| 1.2 | localStorage try-catch | 一 | js/utils.js, js/app.js | ✅ 已完成 |
| 1.3 | 更新 README | 一 | README.md | ✅ 已完成 |
| 2.1 | 自动填充起征点 | 二 | index.html, js/app.js, style.css | ✅ 已完成 |
| 2.2 | Enter 键行为修正 | 二 | js/app.js | ✅ 已完成 |
| 2.3 | 净资产为负 UI | 二 | js/result.js, style.css | ✅ 已完成 |
| 2.4 | 价格获取节流+重试 | 二 | js/app.js | ✅ 已完成 |
| 3.1 | 添加 favicon | 三 | favicon.svg, index.html, result.html | ✅ 已完成 |
| 3.2 | OG 元标签 | 三 | index.html, result.html | ✅ 已完成 |
| 3.3 | a11y 基础修复 | 三 | index.html, result.html, js/app.js, js/result.js | ✅ 已完成 |
| 3.4 | 移动端 inputmode | 三 | index.html | ✅ 已完成 |
| 3.5 | CSS 对比度修正 | 三 | style.css | ✅ 已完成 |

**总预估**: 约 1.5 小时

**阶段二验收（已通过）**：`node --test tests/phase2.test.cjs`（4 项：起征点与草稿单位换算、Enter 焦点行为、获取价格冷却与自动/手动重试、负净资产展示）；`node --check js/app.js`、`node --check js/result.js`、`git diff --check`。

**阶段三验收（已通过）**：两个页面均引用 favicon 和五项 OG 信息；16 个数字输入框均带 `inputmode="decimal"`，16 个普通标签均关联对应输入框，复选框保留包裹式标签；6 个单位按钮含名称与状态并在切换时同步；静态和动态的 21 个装饰 SVG 均设置 `aria-hidden`；`--text-muted` 与 `--ivory` 的实算对比度为 4.92:1。第二阶段 4 项测试、JS 语法和 `git diff --check` 均通过。

---

## 约束与原则

1. **不引入任何构建工具或框架** — 保持原有 Vanilla JS 技术栈
2. **不改变计算逻辑** — 天课比例、起征点判断、资产/债务公式不变
3. **不改变视觉设计** — 配色、布局、动画保持不变（仅微调对比度）
4. **向后兼容 localStorage** — `zakatDraftV2` / `zakatResultV2` 的 schema 不变，已保存的数据不受影响
5. **每阶段可独立验收** — 阶段一完成后即可合并，不依赖阶段二/三
