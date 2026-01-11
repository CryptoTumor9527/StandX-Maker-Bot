# StandX Maker Bot v9.0 🤖

StandX 永续合约交易平台的自动做市机器人,调用官方API+无需钱包私钥+可视化UI版本。

## 👤 作者

**币圈毒瘤**
- Twitter: [@CryptoTumor9527](https://x.com/CryptoTumor9527)
- 义父们妈妈们求个关注🙏

拿到空投不要忘记buy me a coffee：
0x8230a912339e112aeb5b65a5aa00e473f8f0d968

> ⚠️ **风险警告**: 本项目仅供教育和研究使用。加密货币交易存在高风险,可能导致资金损失。作者不对任何损失负责。使用需自行承担风险。

## ✨ 核心特性

- 🔐 **无需钱包私钥** - 安全的 API 请求认证
- 📱 **可视化界面** - 简洁的控制面板,易于配置
- 🎯 **自动做市** - 在当前价格附近自动挂限价单
- 🛡️ **安全阈值** - 0.05% 价格接近保护,防止意外成交
- ⚡ **快速检测** - 0.5 秒持仓监控,即时响应
- 📊 **自动平仓** - 检测到持仓时自动平仓
- 🎲 **灵活策略** - 仅做多、仅做空、双向或随机
- 🔄 **智能刷新** - 定期刷新订单,随机间隔

### 核心功能

| 功能 | 说明 | 状态 |
|------|------|------|
| 自动做市 | 在当前价格 ±0.2% 挂限价单 | ✅ |
| 安全阈值 | 价格接近 0.05% 时取消订单 | ✅ |
| 自动平仓 | 自动检测并平仓 | ✅ |
| 订单刷新 | 每 2-3 分钟刷新订单 | ✅ |
| 价格追踪 | 价格偏离 >0.3% 时调整订单 | ✅ |
| Ed25519 签名 | 安全的 API 认证 | ✅ |

### 高级功能

- **多种交易模式**: 仅做多、仅做空、双向、随机
- **可配置参数**: 杠杆 (1-40x)、订单价值、价格偏移
- **智能检测**: 准确的订单和持仓状态监控
- **错误处理**: 完善的错误处理和日志记录
- **UI 控制面板**: 可视化界面,易于配置

## 📦 安装方法

**适合**: 想要可视化界面和一键操作的用户

1. **安装 Tampermonkey 扩展**
   - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. **安装脚本**
   - 点击 Tampermonkey 图标 → "创建新脚本"
   - 删除默认内容
   - 复制 `standx_maker_bot.js` 的全部内容
   - 粘贴并保存 (Ctrl+S 或 Cmd+S)

3. **使用**
   - 访问 https://standx.com/perps
   - 控制面板自动出现在右上角
   - 配置参数后点击"启动"

# 注意：浏览器必须开启“开发者模式”，并在Tampermonkey插件详情页开启“允许用户运行脚本”开关，建议使用Chrome浏览器。

## 🔑 获取 API Token

在使用机器人之前,你需要获取 StandX 的 API Token。

根据StandX官方API说明文档，当用户登录StandX账户，浏览器缓存中会生成一串cryptokey私钥和一串API Token，脚本需要手动输入API Token，同时调用浏览器缓存中的cryptokey私钥才能执行交易操作。

# 注意：
# 1.cryptokey私钥不是你的钱包私钥，是登录StandX时随机生成，用于签名提交操作，本脚本无需提交、也无法获取你的钱包私钥，提高使用的安全机制。
# 2.cryptokey私钥清除浏览器缓存后失效，脚本运行时需要StandX交易页面保持开启并登录在线；API Token有效期七天，每次登录StandX都需要重新获取。
# 3.cryptokey私钥+API Token仅能对你的StandX账户执行交易操作，无法转移你账户或钱包中的资金，但仍需要妥善保存。

#### 步骤 1: 打开浏览器控制台

- **Windows/Linux**: 按 `F12` 或 `Ctrl+Shift+J`
- **Mac**: 按 `Cmd+Option+J`

#### 步骤 2: 切换到 Network（网络） 标签

在开发者工具顶部,点击 **Network（网络）** 标签

#### 步骤 3: 找到API Token，复制保存

在标签页下方找到任意请求，格式是query_xxxxx,如：
- query_trades……
- query_open_oders……

点击该请求，在Headers（标头）标签页找到 “Authorization”，复制 “Bearer”单词后面的所有字符（不包含Bearer）

类似这样:

Bearer
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

这一串字符就是API Token，有效期7天。

#### 步骤 4: API Token粘贴到机器人

- **Tampermonkey**: 粘贴到控制面板的 "API Token" 输入框

#### 步骤 5: 设置参数，点击启动，运行脚本

### ⚠️ 注意事项

1. **Token 有效期**
   - Token 通常有效期为 **7 天**
   - 过期后需要重新获取
   - 建议定期更新

2. **安全提示**
   - ❌ 不要分享你的 Token
   - ❌ 不要在公共场合展示
   - ✅ Token 泄露后立即重新登录

3. **Token 失效**
   
   如果机器人提示 Token 无效:
   - 重新登录 StandX
   - 重新获取 Token
   - 更新到机器人中

## 🚀 快速开始

### 使用 Tampermonkey

1. 安装脚本并访问 StandX
2. 在控制面板中配置:
   - **API Token**: 自动检测(或手动粘贴)
   - **杠杆**: 1-40x (默认 5x)
   - **订单价值**: DUSD 金额 (默认 2000)
   - **方向**: 做多/做空/双向/随机
   - **价格偏移**: 0.1%-0.3% (默认 0.2%)
3. 点击"启动"按钮
4. 在面板中监控日志

## ⚙️ 配置说明

### 参数详解

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiToken` | string | 自动 | API 认证令牌 |
| `leverage` | number | 5 | 杠杆倍数 (1-40) |
| `orderValue` | number | 2000 | 订单价值 (DUSD) |
| `priceOffset` | number | 0.002 | 价格偏移 (0.2%) |
| `side` | string | 'long' | 交易方向 |
| `autoClosePosition` | boolean | true | 自动平仓 |
| `safetyThreshold` | number | 0.0005 | 安全阈值 (0.05%) |
| `checkIntervalMin` | number | 500 | 最小检查间隔 (毫秒) |
| `checkIntervalMax` | number | 500 | 最大检查间隔 (毫秒) |
| `refreshIntervalMin` | number | 120000 | 最小刷新间隔 (毫秒) |
| `refreshIntervalMax` | number | 180000 | 最大刷新间隔 (毫秒) |
| `maxPriceDeviation` | number | 0.003 | 最大价格偏离 (0.3%) |

### 交易策略

#### 仅做多
```javascript
side: 'long'
```
- 在当前价格下方挂买单
- 适合看涨行情
- 风险较低

#### 仅做空
```javascript
side: 'short'
```
- 在当前价格上方挂卖单
- 适合看跌行情
- 爆仓风险较高

#### 双向
```javascript
side: 'both'
```
- 同时挂买单和卖单
- 双向获利机会
- 需要更多保证金

#### 随机
```javascript
side: 'random'
```
- 每次刷新随机选择方向
- 降低被检测风险
- 适合长期运行

### 价格偏移建议

| 偏移 | 成交率 | 风险 | 使用场景 |
|------|--------|------|----------|
| 0.1% | 高 | 高 | 快速成交 |
| 0.2% | 中 | 中 | **推荐** 平衡策略 |
| 0.3% | 低 | 低 | 保守策略 |

### 订单价值示例

以 BTC = $90,000 为例:

| 价值 (DUSD) | BTC 数量 | 5x 杠杆 | 所需保证金 |
|-------------|----------|---------|-----------|
| 1000 | 0.0111 | $5,000 | ~$1,000 |
| 2000 | 0.0222 | $10,000 | ~$2,000 |
| 5000 | 0.0556 | $25,000 | ~$5,000 |

## 🛡️ 安全机制

### 1. 安全阈值 (0.05%)

当价格过于接近订单时自动取消:

```
当前价格: $90,000
订单价格: $90,045
偏离: 0.05% → 触发安全机制 → 取消订单
```

这可以防止在不利价格意外成交。

### 2. 自动平仓

检测到持仓时:
1. 取消所有挂单
2. 下达激进的平仓单(距当前价 3%)
3. 验证持仓已平
4. 如需要,使用更激进价格重试(距当前价 5%)

### 3. 价格偏离检查

当价格偏离上次订单价格 >0.3% 时刷新订单。

## 🔒 安全建议

### ⚠️ 重要警告

1. **资金风险**
   - 加密货币交易风险极高
   - 可能导致全部资金损失
   - 仅使用可承受损失的资金

2. **自动平仓风险**
   - 启用 `autoClosePosition` 会自动平仓
   - 可能在不利价格平仓
   - 建议先用小额测试

3. **技术风险**
   - 网络中断可能影响订单管理
   - 关闭浏览器会停止机器人
   - 需要定期监控

### ✅ 推荐做法

1. **从小额开始**
   ```javascript
   orderValue: 1000  // 从最小金额开始
   ```

2. **使用合理杠杆**
   ```javascript
   leverage: 2  // 低杠杆降低爆仓风险
   ```

3. **保守策略**
   ```javascript
   priceOffset: 0.003,      // 0.3% 不易成交
   side: 'long',            // 单向交易
   autoClosePosition: true  // 启用自动平仓
   ```

4. **定期监控**
   - 每小时检查一次状态
   - 关注账户余额变化
   - 及时调整策略

5. **设置止损**
   - 在 StandX 平台设置止损单
   - 限制最大损失

### 🚫 不建议

- ❌ 使用全部资金
- ❌ 高杠杆 (>10x)
- ❌ 长时间无人监控
- ❌ 高波动时段运行
- ❌ 同时运行多个机器人

## 🤝 贡献指南

欢迎贡献代码!请随时提交问题或拉取请求。

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 代码规范

- 使用 ES6+ 语法
- 添加详细注释
- 遵循现有代码风格
- 更新相关文档

### 报告问题

请包含:
- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- 控制台日志
- 浏览器版本

## ⚖️ 免责声明

本软件按"原样"提供,不提供任何明示或暗示的保证。使用风险自负。

- 本软件仅供教育和研究目的
- 作者不对使用本软件造成的任何损失负责
- 加密货币交易存在高风险
- 请遵守当地法律法规
- 使用前请充分了解风险

## 🙏 致谢

- StandX 交易平台
- Tampermonkey 团队
- 所有贡献者

## 👤 作者

**币圈毒瘤**
- Twitter: [@CryptoTumor9527](https://x.com/CryptoTumor9527)
- 义父们妈妈们求个关注🙏

## 📞 联系方式
- Twitter: [@CryptoTumor9527](https://x.com/CryptoTumor9527)

---

**⭐ 如果这个项目对你有帮助,请给个 Star!**

**用 ❤️ 为 StandX 社区打造**

