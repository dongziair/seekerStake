import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

loadDotEnv();


const PROGRAM_ID = new PublicKey('SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ');
const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const EVENT_AUTHORITY = new PublicKey('8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir');
const EXPECTED_WALLET = new PublicKey('2xXqH7WPUVmCNFkuPTJMhjVHFat9UntASMHJGZSUJEWY');

// This is the exact outer instruction data from your successful Stake tx.
const STAKE_ONE_SKR_DATA = bs58.decode('SXLVHmrGRvofJanwcCfNej');
const ORIGINAL_COMPUTE_BUDGET_DATA = [
  bs58.decode('GZk52X'),
  bs58.decode('3QGMXYP8FsXD')
];

const STAKE_ACCOUNTS = [
  { pubkey: new PublicKey('BfEsT4CDmsLmp4jdR8RZ2ATEAYXbsry1xNBD3wdK9kfq'), isSigner: false, isWritable: true },
  { pubkey: new PublicKey('4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw'), isSigner: false, isWritable: true },
  { pubkey: new PublicKey('DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr'), isSigner: false, isWritable: true },
  { pubkey: EXPECTED_WALLET, isSigner: true, isWritable: true },
  { pubkey: EXPECTED_WALLET, isSigner: true, isWritable: true },
  { pubkey: new PublicKey('9tEGCZsVvxg8dMJ3WbhJWb73BD5ZdE7EDA1R9DuMHukH'), isSigner: false, isWritable: true },
  { pubkey: new PublicKey('8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8'), isSigner: false, isWritable: true },
  { pubkey: new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'), isSigner: false, isWritable: true },
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
  { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }
];

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const COUNT = 100;
const DURATION_MS = 60 * 60 * 1000;
const SAFETY_BUFFER_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 5_000;
const DAILY_REPEAT_DELAY_MS = 24 * 60 * 60 * 1000;

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

function loadKeypair() {
  const keypairPath = argValue('--keypair', process.env.SOL_KEYPAIR_PATH);
  const privateKey = process.env.SOL_PRIVATE_KEY;

  if (keypairPath) {
    if (!existsSync(keypairPath)) {
      throw new Error(`Keypair file not found: ${keypairPath}`);
    }
    const parsed = JSON.parse(readFileSync(keypairPath, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  if (!privateKey) {
    throw new Error('Set SOL_PRIVATE_KEY or pass --keypair path/to/keypair.json');
  }

  const trimmed = privateKey.trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }

  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function makeRandomSchedule(count, totalMs) {
  if (count <= 1) return [0];

  const weights = Array.from({ length: count - 1 }, () => -Math.log(Math.random()));
  const sum = weights.reduce((total, value) => total + value, 0);
  const delays = weights.map((weight) => Math.floor((weight / sum) * totalMs));

  return [0, ...delays];
}

function makeStakeTransaction() {
  const stakeInstruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: STAKE_ACCOUNTS,
    data: STAKE_ONE_SKR_DATA
  });

  const computeBudgetInstructions = ORIGINAL_COMPUTE_BUDGET_DATA.map((data) => new TransactionInstruction({
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    keys: [],
    data
  }));

  return new Transaction().add(stakeInstruction, ...computeBudgetInstructions);
}

async function sendWithRetry(connection, payer, attemptIndex) {
  const transaction = makeStakeTransaction();

  try {
    return await sendAndConfirmTransaction(connection, transaction, [payer], {
      commitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 3
    });
  } catch (error) {
    console.error(`[${attemptIndex}/${COUNT}] first send failed: ${error.message}`);
    await sleep(RETRY_DELAY_MS);
    return sendAndConfirmTransaction(connection, makeStakeTransaction(), [payer], {
      commitment: 'confirmed',
      skipPreflight: false,
      maxRetries: 3
    });
  }
}

async function main() {
  const execute = hasFlag('--execute');
  const repeatDaily = hasFlag('--repeat-daily');
  const rpcUrl = argValue('--rpc', process.env.SOLANA_RPC_URL || DEFAULT_RPC);
  const waitBudgetMs = Number(argValue('--wait-ms', DURATION_MS - SAFETY_BUFFER_MS));
  const payer = loadKeypair();

  if (!payer.publicKey.equals(EXPECTED_WALLET)) {
    throw new Error(`Loaded wallet is ${payer.publicKey.toBase58()}, expected ${EXPECTED_WALLET.toBase58()}`);
  }

  console.log(`wallet: ${payer.publicKey.toBase58()}`);
  console.log(`rpc: ${rpcUrl}`);
  console.log(`mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`repeat daily: ${repeatDaily ? 'yes' : 'no'}`);
  console.log(`planned stakes: ${COUNT} x 1 SKR`);

  if (!execute) {
    console.log('Dry run only. Add --execute to send real mainnet transactions.');
    return;
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  let round = 1;

  while (true) {
    const logPath = argValue('--log', `stake-results-${Date.now()}-round-${round}.jsonl`);
    const schedule = makeRandomSchedule(COUNT, waitBudgetMs);
    const startedAt = Date.now();

    console.log(`round: ${round}`);
    console.log(`planned random wait total: ${Math.round(schedule.reduce((a, b) => a + b, 0) / 1000)} seconds`);
    console.log(`log file: ${logPath}`);

    for (let index = 0; index < COUNT; index += 1) {
      const delay = schedule[index];
      if (delay > 0) {
        console.log(`[${index + 1}/${COUNT}] waiting ${Math.round(delay / 1000)}s`);
        await sleep(delay);
      }

      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[${index + 1}/${COUNT}] staking 1 SKR, elapsed ${elapsedSeconds}s`);

      const signature = await sendWithRetry(connection, payer, index + 1);
      const record = {
        round,
        index: index + 1,
        signature,
        elapsedSeconds,
        sentAt: new Date().toISOString()
      };

      appendFileSync(logPath, `${JSON.stringify(record)}\n`);
      console.log(`[${index + 1}/${COUNT}] confirmed: https://solscan.io/tx/${signature}`);
    }

    console.log(`round ${round} done in ${Math.round((Date.now() - startedAt) / 1000)} seconds`);

    if (!repeatDaily) break;

    const nextRunAt = new Date(Date.now() + DAILY_REPEAT_DELAY_MS).toISOString();
    console.log(`waiting 24 hours before next round; next run around ${nextRunAt}`);
    await sleep(DAILY_REPEAT_DELAY_MS);
    round += 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
