# E2E Testing Skill Context

## 选择器策略

优先使用以下选择器类型（按稳定性排序）：
1. `data-testid` 属性（如 `[data-testid="login-btn"]`）
2. `aria-label` 属性
3. ARIA `role` + 可访问名称
4. 避免使用带 hash 后缀的 CSS class

## 已知元素

### 登录页面
- 登录按钮: `[data-testid="login-btn"]` 或 `[aria-label="Sign in"]`
- 用户名输入: `[data-testid="email-input"]` 或 `[name="email"]`
- 密码输入: `[data-testid="password-input"]` 或 `[name="password"]`

### 商品页面
- 搜索框: `[data-testid="search-input"]`
- 搜索按钮: `[data-testid="search-btn"]`
- 商品卡片: `[data-testid^="product-card"]`

### 结算页面
- 地址输入: `[data-testid="address-input"]`
- 支付方式选择: `[data-testid="payment-method"]`
- 支付按钮: `[data-testid="pay-btn"]`

## 注意事项

- 登录按钮在加载时可能显示 `aria-disabled="true"`，需要等待
- 验证码在 `iframe#captcha-frame` 中
- 搜索框在移动端可能折叠在汉堡菜单中
- 支付按钮可能需要先选择支付方式才能点击

## 错误恢复策略

- 如果元素未找到，尝试等待 1-2 秒后重试
- 如果按钮被禁用，等待 `aria-disabled` 属性消失
- 如果元素在 iframe 中，使用跨 iframe 选择器
- 如果页面正在加载，等待网络请求完成
