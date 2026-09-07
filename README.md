# SKR Auto Staker (多钱包拟人化自动质押系统)

基于 Solana 链开发的 SKR 代币自动质押脚本，完全复刻 Solana Mobile Seeker 手机端原生交易结构，支持**多钱包管理、单次 1~3 SKR 动态随机金额、每日在 12 小时内随机完成 30~50 次质押**的真人化拟真交互。

---

## 核心特性

- **多钱包并发/交错执行**：支持通过 `wallets.json` 批量管理钱包私钥（Base58 字符串、Keypair JSON 数组或文件路径）。
- **动态金额质押 (1~3 SKR 随机)**：每次质押时随机确定金额（支持 1、2、3 SKR 整数，或可选 `--decimal` 带小数），动态编码 Anchor 16 字节指令。
- **拟人化时间调度**：
  - 单钱包每日总次数在 **30 ~ 50 次** 之间随机。
  - 在 **12 小时** 活跃窗口内采用指数分布随机散落时间点。
  - 多钱包任务在全局时间轴上**随机交错穿插**，极大降低被风控系统聚类识别的风险。
- **自动 PDA 派生与代币账户匹配**：自动为各钱包派生官方 `user_stake` 状态账户，并动态匹配或派生其 SKR Token Account。
- **多级 RPC 故障转移与重试**：优先使用高速专有节点（如 Helius），故障时无缝降级至备用公共节点并自动重试。
- **24 小时自动循环 (可选)**：开启 `--repeat-daily` 时，12 小时任务执行完毕后自动休眠补满 24 小时自然周期，次日自动生成全新随机时间轴继续执行。

---

## 快速上手

### 1. 安装依赖

```powershell
npm install
```

### 2. 配置钱包

复制 `wallets.example.json` 为 `wallets.json`：

```powershell
copy wallets.example.json wallets.json
```

编辑 `wallets.json`，配置多个钱包的私钥（支持多种格式，已自动在 `.gitignore` 中防泄露）：

```json
[
  {
    "label": "Seeker-01",
    "privateKey": "5K...base58私钥..."
  },
  {
    "label": "Seeker-02",
    "privateKey": "[12,34,56,...64位数组...]"
  },
  {
    "label": "Seeker-03",
    "keypairPath": "D:\\solana-wallets\\wallet3.json"
  }
]
```

> **注意**：每个钱包需准备少量 `SOL`（支付 Gas，建议 0.02~0.05 SOL）以及足够的 `SKR` 代币。

### 3. 配置 RPC 节点 (可选但推荐)

在项目根目录下创建 `.env` 配置优质 RPC（如 Helius）：

```env
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_api_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

---

## 运行模式

### 1. 预演演练模式 (Dry Run)

不消耗 Gas 与代币，仅进行环境配置预检、资产扫描，并预览今日多钱包拟人化时间轴：

```powershell
npm run stake:multi
```

### 2. 真实单日运行 (12 小时窗口)

多钱包各随机质押 30~50 次，每次 1~3 SKR，在 12 小时内随机交错完成，完成后自动退出：

```powershell
npm run stake:multi -- --execute
```

### 3. 24 小时自动长期循环 (挂机模式)

执行 12 小时后自动休眠，次日准时开启全新一轮质押：

```powershell
npm run stake:multi -- --execute --repeat-daily
```

---

## 可选参数 (CLI Flags)

| 参数 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `--execute` | `false` | 显式声明向 Solana 主网提交真实交易（默认仅 Dry Run 预演） |
| `--repeat-daily` | `false` | 开启每日 24 小时自动循环（12h 质押 + 12h 休眠） |
| `--wallets <path>` | `wallets.json` | 指定多钱包配置文件路径 |
| `--min-stakes <n>` | `30` | 每个钱包每日质押最小次数 |
| `--max-stakes <n>` | `50` | 每个钱包每日质押最大次数 |
| `--min-amount <n>` | `1` | 单笔质押最小 SKR 数量 |
| `--max-amount <n>` | `3` | 单笔质押最大 SKR 数量 |
| `--window-hours <h>`| `12` | 每日质押活跃时间窗口（单位：小时） |
| `--decimal` | `false` | 允许带 1 位小数的随机金额（如 1.5, 2.7 SKR） |
| `--rpc <url>` | 无 | 优先指定的 Solana RPC 节点地址 |
| `--log <path>` | 自动生成 | 自定义结果记录 JSONL 文件路径 |

示例：自定义每天执行 35~45 次、金额 1~3 SKR、在 10 小时窗口内完成：

```powershell
npm run stake:multi -- --execute --min-stakes 35 --max-stakes 45 --window-hours 10
```
