import {
  Connection,
  Keypair,
  Message,
  PublicKey
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

loadDotEnv();

// --- 核心协议地址与常量 ---
const PROGRAM_ID = new PublicKey('SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ');
const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const EVENT_AUTHORITY = new PublicKey('8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir');
const STAKE_CONFIG = new PublicKey('4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw');
const GUARDIAN_POOL = new PublicKey('DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr');
const SKR_MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
const VAULT_TOKEN_ACCOUNT = new PublicKey('8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8');
const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5P4mt9zEKh2N7fGyX');

// Anchor Stake 指令 Discriminator (sha256("global:stake")[0..8])
const ANCHOR_STAKE_DISCRIMINATOR = Buffer.from('ceb0ca12c8d1b36c', 'hex');

// Seeker 手机钱包原生交易自带的 Compute Budget 指令参数
const ORIGINAL_COMPUTE_BUDGET_DATA = [
  bs58.decode('GZk52X'),       // setComputeUnitLimit: 60,000
  bs58.decode('3QGMXYP8FsXD')  // setComputeUnitPrice
];

const PUBLIC_RPC_URL = 'https://api.mainnet-beta.solana.com';

// 默认调度参数（均可通过命令行覆盖）
const DEFAULT_MIN_STAKES = 30;
const DEFAULT_MAX_STAKES = 50;
const DEFAULT_MIN_AMOUNT = 1;
const DEFAULT_MAX_AMOUNT = 3;
const DEFAULT_WINDOW_HOURS = 12;
const DEFAULT_SAFETY_BUFFER_MINUTES = 20; // 预留 20 分钟缓冲
const RETRY_DELAY_MS = 5_000;
const FULL_DAY_MS = 24 * 60 * 60 * 1000;

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloatInclusive(min, max, decimals = 1) {
  const factor = Math.pow(10, decimals);
  const val = Math.random() * (max - min) + min;
  return Math.round(val * factor) / factor;
}

function parsePrivateKey(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

// 加载多钱包列表
function loadWallets() {
  const walletsPath = argValue('--wallets', 'wallets.json');
  const wallets = [];

  if (existsSync(walletsPath)) {
    console.log(`[配置] 读取多钱包配置文件: ${walletsPath}`);
    const content = JSON.parse(readFileSync(walletsPath, 'utf8'));
    if (!Array.isArray(content)) {
      throw new Error(`${walletsPath} 内容必须是钱包配置数组`);
    }

    content.forEach((item, idx) => {
      const label = item.label || `Wallet-${String(idx + 1).padStart(2, '0')}`;
      let keypair;
      if (item.keypairPath) {
        if (!existsSync(item.keypairPath)) {
          throw new Error(`[${label}] Keypair 文件不存在: ${item.keypairPath}`);
        }
        const parsed = JSON.parse(readFileSync(item.keypairPath, 'utf8'));
        keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
      } else if (item.privateKey) {
        keypair = parsePrivateKey(item.privateKey);
      } else if (typeof item === 'string') {
        keypair = parsePrivateKey(item);
      } else {
        throw new Error(`[${label}] 未能找到有效的 privateKey 或 keypairPath 配置`);
      }

      wallets.push({ label, keypair });
    });
  } else {
    // 兼容原有单钱包方式（.env 或 --keypair）
    const keypairPath = argValue('--keypair', process.env.SOL_KEYPAIR_PATH);
    const privateKey = process.env.SOL_PRIVATE_KEY;

    if (keypairPath) {
      if (!existsSync(keypairPath)) {
        throw new Error(`Keypair 文件未找到: ${keypairPath}`);
      }
      const parsed = JSON.parse(readFileSync(keypairPath, 'utf8'));
      wallets.push({
        label: 'Wallet-01',
        keypair: Keypair.fromSecretKey(Uint8Array.from(parsed))
      });
    } else if (privateKey) {
      wallets.push({
        label: 'Wallet-01',
        keypair: parsePrivateKey(privateKey)
      });
    }
  }

  if (wallets.length === 0) {
    throw new Error('未配置任何有效钱包！请创建 wallets.json 或在 .env 中设置 SOL_PRIVATE_KEY');
  }

  return wallets;
}

function getRpcUrls() {
  const list = [
    argValue('--rpc', undefined),
    process.env.HELIUS_RPC_URL,
    process.env.SOLANA_RPC_URL,
    PUBLIC_RPC_URL
  ].filter(Boolean);
  return [...new Set(list)];
}

// 动态构造 Anchor Stake 指令数据（传入 SKR 数量，单位 SKR，精度 6 位小数）
function makeStakeInstructionData(skrAmount) {
  const amountBigInt = BigInt(Math.round(skrAmount * 1_000_000));
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amountBigInt, 0);
  return Buffer.concat([ANCHOR_STAKE_DISCRIMINATOR, amountBuf]);
}

// 派生钱包对应的 user_stake PDA 账户
function deriveUserStakePda(walletPublicKey) {
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('user_stake'),
      STAKE_CONFIG.toBuffer(),
      walletPublicKey.toBuffer(),
      GUARDIAN_POOL.toBuffer()
    ],
    PROGRAM_ID
  );
  return userStakePda;
}

// 查询或派生钱包的 SKR Token 账户
async function resolveUserTokenAccount(connection, walletPublicKey) {
  try {
    const res = await connection.getTokenAccountsByOwner(walletPublicKey, { mint: SKR_MINT });
    if (res.value && res.value.length > 0) {
      return res.value[0].pubkey;
    }
  } catch (e) {
    // 忽略单次网络查询错误，降级至标准 ATA
  }

  const [ata] = PublicKey.findProgramAddressSync(
    [walletPublicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), SKR_MINT.toBuffer()],
    ATA_PROGRAM_ID
  );
  return ata;
}

// 组装与 Seeker 手机钱包完全一致的 Legacy Message
function makePhoneStyleMessage(walletPubkey, userStakePda, userTokenAccount, skrAmount, recentBlockhash) {
  const accountKeys = [
    walletPubkey,
    userStakePda,
    STAKE_CONFIG,
    GUARDIAN_POOL,
    userTokenAccount,
    VAULT_TOKEN_ACCOUNT,
    SKR_MINT,
    TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    EVENT_AUTHORITY,
    PROGRAM_ID,
    COMPUTE_BUDGET_PROGRAM_ID
  ];

  const stakeInstructionData = makeStakeInstructionData(skrAmount);

  return new Message({
    header: {
      numRequiredSignatures: 1,
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 5
    },
    accountKeys,
    recentBlockhash,
    instructions: [
      {
        programIdIndex: 10,
        accounts: [1, 2, 3, 0, 0, 4, 5, 6, 7, 8, 9, 10],
        data: bs58.encode(stakeInstructionData)
      },
      {
        programIdIndex: 11,
        accounts: [],
        data: bs58.encode(ORIGINAL_COMPUTE_BUDGET_DATA[0])
      },
      {
        programIdIndex: 11,
        accounts: [],
        data: bs58.encode(ORIGINAL_COMPUTE_BUDGET_DATA[1])
      }
    ]
  });
}

function encodeShortVecLength(length) {
  const bytes = [];
  let remaining = length;
  while (true) {
    let element = remaining & 0x7f;
    remaining >>= 7;
    if (remaining === 0) {
      bytes.push(element);
      break;
    }
    element |= 0x80;
    bytes.push(element);
  }
  return Uint8Array.from(bytes);
}

function makeRawSignedTransaction(message, payer) {
  const messageBytes = message.serialize();
  const signature = ed25519.sign(messageBytes, payer.secretKey.slice(0, 32));
  const signatureCount = encodeShortVecLength(1);
  const rawTransaction = new Uint8Array(signatureCount.length + signature.length + messageBytes.length);

  rawTransaction.set(signatureCount, 0);
  rawTransaction.set(signature, signatureCount.length);
  rawTransaction.set(messageBytes, signatureCount.length + signature.length);

  return rawTransaction;
}

async function sendPhoneStyleTransaction(connection, payer, userStakePda, userTokenAccount, skrAmount) {
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const message = makePhoneStyleMessage(
    payer.publicKey,
    userStakePda,
    userTokenAccount,
    skrAmount,
    latestBlockhash.blockhash
  );
  const rawTransaction = makeRawSignedTransaction(message, payer);

  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    maxRetries: 3
  });

  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
  }, 'confirmed');

  if (confirmation.value.err) {
    throw new Error(`交易执行失败: ${JSON.stringify(confirmation.value.err)}`);
  }

  return signature;
}

async function sendWithRetry(connections, payer, userStakePda, userTokenAccount, skrAmount, taskLabel) {
  let lastError;
  for (let round = 1; round <= 2; round += 1) {
    for (const { label, connection } of connections) {
      try {
        if (round > 1) {
          console.log(`${taskLabel} 重试中 (节点: ${label})`);
        }
        return await sendPhoneStyleTransaction(connection, payer, userStakePda, userTokenAccount, skrAmount);
      } catch (error) {
        lastError = error;
        console.error(`${taskLabel} [${label}] 发送失败: ${error.message}`);
      }
    }
    await sleep(RETRY_DELAY_MS);
  }
  throw lastError;
}

// --- 拟人化时间调度核心算法 ---
// 在 windowMs 时间窗口内，为每个钱包独立随机生成次数与时间序列，随后合并为全局交织队列
function buildHumanInterleavedSchedule(wallets, options) {
  const {
    minStakes,
    maxStakes,
    minAmount,
    maxAmount,
    allowDecimalAmount,
    windowMs
  } = options;

  const allEvents = [];

  wallets.forEach((walletInfo, walletIdx) => {
    const stakeCount = randomIntInclusive(minStakes, maxStakes);

    // 采用无记忆到达模型（指数分布）生成拟人化随机间隔
    const rawWeights = Array.from({ length: stakeCount }, () => -Math.log(Math.random() || 0.0001));
    const sumWeights = rawWeights.reduce((a, b) => a + b, 0);

    let currentOffset = 0;
    for (let i = 0; i < stakeCount; i++) {
      const stepDelay = Math.floor((rawWeights[i] / sumWeights) * windowMs);
      currentOffset += stepDelay;

      // 每次质押金额 1~3 个 SKR 随机
      const amount = allowDecimalAmount
        ? randomFloatInclusive(minAmount, maxAmount, 1)
        : randomIntInclusive(minAmount, maxAmount);

      allEvents.push({
        wallet: walletInfo,
        walletIndex: walletIdx,
        stakeIndex: i + 1,
        totalStakesForWallet: stakeCount,
        amount,
        scheduledOffsetMs: currentOffset
      });
    }
  });

  // 按计划触发时间排序，形成多钱包穿插交错的时间线
  allEvents.sort((a, b) => a.scheduledOffsetMs - b.scheduledOffsetMs);

  return allEvents;
}

async function main() {
  const execute = hasFlag('--execute');
  const repeatDaily = hasFlag('--repeat-daily');
  const allowDecimal = hasFlag('--decimal'); // 是否允许带小数的质押数量 (如 1.5, 2.3)

  const minStakes = Number(argValue('--min-stakes', DEFAULT_MIN_STAKES));
  const maxStakes = Number(argValue('--max-stakes', DEFAULT_MAX_STAKES));
  const minAmount = Number(argValue('--min-amount', DEFAULT_MIN_AMOUNT));
  const maxAmount = Number(argValue('--max-amount', DEFAULT_MAX_AMOUNT));
  const windowHours = Number(argValue('--window-hours', DEFAULT_WINDOW_HOURS));

  const totalWindowMs = windowHours * 60 * 60 * 1000;
  const safetyBufferMs = DEFAULT_SAFETY_BUFFER_MINUTES * 60 * 1000;
  const executionBudgetMs = Math.max(totalWindowMs - safetyBufferMs, 60 * 1000);

  const rpcUrls = getRpcUrls();
  const wallets = loadWallets();

  console.log('====================================================');
  console.log('            SKR 多钱包拟人化自动质押引擎             ');
  console.log('====================================================');
  console.log(`[配置] 钱包数量: ${wallets.length} 个`);
  wallets.forEach((w, i) => {
    console.log(`  - [${w.label}] ${w.keypair.publicKey.toBase58()}`);
  });
  console.log(`[配置] 单钱包每日质押频次: ${minStakes} ~ ${maxStakes} 次 (随机)`);
  console.log(`[配置] 单笔质押金额: ${minAmount} ~ ${maxAmount} SKR (随机${allowDecimal ? '，含1位小数' : '整数'})`);
  console.log(`[配置] 每日执行窗口: ${windowHours} 小时 (实际调度预算约 ${Math.round(executionBudgetMs / 3600000 * 10) / 10} 小时)`);
  console.log(`[配置] 每日循环模式: ${repeatDaily ? '开启 (执行12h后休眠12h)' : '单日模式 (执行完成后退出)'}`);
  console.log(`[配置] 执行模式: ${execute ? '>>> 真实链上交易 (EXECUTE) <<<' : '*** 预演演练模式 (DRY RUN) ***'}`);
  console.log(`[配置] RPC 节点优先级: ${rpcUrls.join(' -> ')}`);
  console.log('====================================================\n');

  const connections = rpcUrls.map((url, index) => ({
    label: index === 0 ? `主节点 (${url})` : `备用节点 (${url})`,
    connection: new Connection(url, 'confirmed')
  }));
  const primaryConn = connections[0].connection;

  // 预检每个钱包的 SOL 和 SKR 余额及关联账户
  console.log('[预检] 正在获取各钱包链上资产与账户信息...');
  const walletContexts = new Map();
  for (const w of wallets) {
    const pubkey = w.keypair.publicKey;
    const userStakePda = deriveUserStakePda(pubkey);
    let userTokenAccount;
    let solBalance = 0;
    let skrBalance = 0;

    try {
      solBalance = (await primaryConn.getBalance(pubkey)) / 1e9;
      userTokenAccount = await resolveUserTokenAccount(primaryConn, pubkey);
      const tokenAccInfo = await primaryConn.getTokenAccountBalance(userTokenAccount);
      skrBalance = tokenAccInfo.value.uiAmount || 0;
    } catch (e) {
      userTokenAccount = userTokenAccount || (await resolveUserTokenAccount(primaryConn, pubkey));
    }

    walletContexts.set(w.keypair.publicKey.toBase58(), {
      userStakePda,
      userTokenAccount,
      solBalance,
      skrBalance
    });

    console.log(`  [${w.label}] SOL: ${solBalance.toFixed(4)} | SKR: ${skrBalance} | TokenAcc: ${userTokenAccount.toBase58().slice(0, 8)}... | StakePDA: ${userStakePda.toBase58().slice(0, 8)}...`);
  }
  console.log('');

  if (!execute) {
    console.log('[提示] 当前处于预演模式 (DRY RUN)，不会发送真实交易。');
    console.log('[提示] 若需向主网真实发送交易，请添加 --execute 参数。\n');

    // 预演生成今日拟人调度表并展示
    const sampleSchedule = buildHumanInterleavedSchedule(wallets, {
      minStakes,
      maxStakes,
      minAmount,
      maxAmount,
      allowDecimalAmount: allowDecimal,
      windowMs: executionBudgetMs
    });

    console.log(`[预演] 今日预计总交易数: ${sampleSchedule.length} 笔 (多钱包混合调度)`);
    console.log('[预演] 抽样前 8 个拟人调度事件:');
    sampleSchedule.slice(0, 8).forEach((ev, idx) => {
      const mins = Math.round(ev.scheduledOffsetMs / 60000);
      console.log(`  #${idx + 1} | +${mins}m | [${ev.wallet.label}] 质押 ${ev.amount} SKR (该钱包第 ${ev.stakeIndex}/${ev.totalStakesForWallet} 次)`);
    });
    if (sampleSchedule.length > 8) {
      console.log(`  ... 其余 ${sampleSchedule.length - 8} 个事件已随时间离散分布在整个 12 小时内。`);
    }
    return;
  }

  let dayRound = 1;

  while (true) {
    const dayStartedAt = Date.now();
    const logPath = argValue('--log', `stake-results-${dayStartedAt}-day-${dayRound}.jsonl`);

    console.log(`\n================= 开始第 ${dayRound} 天质押任务 =================`);
    console.log(`[调度] 正在为各钱包构建 12 小时拟人化交织时间轴...`);

    const dailySchedule = buildHumanInterleavedSchedule(wallets, {
      minStakes,
      maxStakes,
      minAmount,
      maxAmount,
      allowDecimalAmount: allowDecimal,
      windowMs: executionBudgetMs
    });

    console.log(`[调度] 当日总交易任务数: ${dailySchedule.length} 笔`);
    console.log(`[调度] 日志记录文件: ${logPath}`);
    console.log(`[调度] 任务执行开始时间: ${new Date().toLocaleString()}`);

    const walletProgress = new Map();
    wallets.forEach((w) => walletProgress.set(w.label, 0));

    for (let i = 0; i < dailySchedule.length; i++) {
      const event = dailySchedule[i];
      const now = Date.now();
      const targetTime = dayStartedAt + event.scheduledOffsetMs;
      const waitMs = targetTime - now;

      if (waitMs > 0) {
        const waitSec = Math.round(waitMs / 1000);
        console.log(`[等待] 拟人化随机等待 ${waitSec} 秒... (下一笔: [${event.wallet.label}] 质押 ${event.amount} SKR)`);
        await sleep(waitMs);
      }

      const elapsedMinutes = Math.round((Date.now() - dayStartedAt) / 60000);
      const currentCompleted = (walletProgress.get(event.wallet.label) || 0) + 1;
      walletProgress.set(event.wallet.label, currentCompleted);

      const taskLabel = `[全局进度 ${i + 1}/${dailySchedule.length} | 已运行 ${elapsedMinutes}m] [${event.wallet.label}]`;
      console.log(`${taskLabel} 准备质押 ${event.amount} SKR (该钱包进度: ${currentCompleted}/${event.totalStakesForWallet})`);

      const ctx = walletContexts.get(event.wallet.keypair.publicKey.toBase58());
      try {
        const signature = await sendWithRetry(
          connections,
          event.wallet.keypair,
          ctx.userStakePda,
          ctx.userTokenAccount,
          event.amount,
          taskLabel
        );

        const record = {
          dayRound,
          globalIndex: i + 1,
          totalEventsToday: dailySchedule.length,
          walletLabel: event.wallet.label,
          walletAddress: event.wallet.keypair.publicKey.toBase58(),
          walletProgress: `${currentCompleted}/${event.totalStakesForWallet}`,
          skrAmount: event.amount,
          signature,
          elapsedMinutes,
          confirmedAt: new Date().toISOString()
        };

        appendFileSync(logPath, `${JSON.stringify(record)}\n`);
        console.log(`${taskLabel} ✅ 质押确认成功! TX: https://solscan.io/tx/${signature}`);
      } catch (err) {
        console.error(`${taskLabel} ❌ 最终质押失败: ${err.message}`);
      }
    }

    const dayDurationHours = ((Date.now() - dayStartedAt) / 3600000).toFixed(2);
    console.log(`\n🎉 第 ${dayRound} 天全部质押任务执行完毕！总耗时: ${dayDurationHours} 小时`);

    if (!repeatDaily) {
      console.log('单日模式执行完成，程序安全退出。');
      break;
    }

    // 每日循环模式：休眠补满 24 小时自然周期
    const elapsedSinceDayStart = Date.now() - dayStartedAt;
    const sleepForTomorrowMs = Math.max(FULL_DAY_MS - elapsedSinceDayStart, 60 * 1000);
    const sleepHours = (sleepForTomorrowMs / 3600000).toFixed(2);
    const nextDayStartTime = new Date(Date.now() + sleepForTomorrowMs).toLocaleString();

    console.log(`[休眠] 进入夜间/自然休眠模式 (${sleepHours} 小时)，拟定于 ${nextDayStartTime} 开启下一日任务...`);
    await sleep(sleepForTomorrowMs);
    dayRound += 1;
  }
}

main().catch((error) => {
  console.error('[致命错误]', error);
  process.exit(1);
});
