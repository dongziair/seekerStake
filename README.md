# SKR Auto Staker

This folder contains a small Node.js script that repeats the same SKR stake call as the reference Solana transaction:

https://solscan.io/tx/1EGUVGth2SzsDc3nhEomW3nSJhVGkXKWeEQuiGdp2wfybvxULLcWjLH8eq7oasiDc7iT8DRx77Kf5vJaS8ebBDn

The script stakes `1 SKR` per transaction, `100` times per round, with random timing so the round finishes within about one hour. It can optionally repeat every 24 hours.

## What It Does

- Calls the SKR staking program:
  `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ`
- Uses the same outer stake instruction data from the reference transaction.
- Uses the same account list and instruction order as the reference transaction.
- Sends `100` stake transactions per round.
- Writes confirmed transaction signatures to a local `stake-results-*.jsonl` file.

Some transaction fields cannot be identical every time, including signature, recent blockhash, slot, timestamp, and network-dependent fees.

## Setup

Install dependencies:

```powershell
npm install
```

Edit `.env` and fill in one private key option.

Option A: use a Solana CLI-style keypair JSON file:

```env
SOL_KEYPAIR_PATH=D:\path\to\id.json
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Option B: put the private key directly in `.env`:

```env
SOL_PRIVATE_KEY=your_private_key_here
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Do not send the private key in chat. Keep `.env` private.

## Dry Run

Run without `--execute` to check that the script loads:

```powershell
npm run stake:skr
```

Dry run does not send transactions.

## Run Once

Stake `100` times, randomly spaced within the one-hour window:

```powershell
npm run stake:skr -- --execute
```

## Repeat Every 24 Hours

Stake `100` times, wait 24 hours after the round finishes, then repeat:

```powershell
npm run stake:skr -- --execute --repeat-daily
```

Keep the terminal and computer running for this mode. Stop it with `Ctrl+C`.

## Optional Flags

Use a different RPC endpoint:

```powershell
npm run stake:skr -- --execute --rpc https://your-rpc.example
```

Use a keypair file without editing `.env`:

```powershell
npm run stake:skr -- --execute --keypair D:\path\to\id.json
```

Use a custom log file:

```powershell
npm run stake:skr -- --execute --log stake-results.jsonl
```

Change the random wait budget in milliseconds:

```powershell
npm run stake:skr -- --execute --wait-ms 3300000
```

The default wait budget is 55 minutes, leaving a small buffer inside the one-hour target.

## Safety Notes

- The script only accepts the expected wallet from the reference transaction:
  `2xXqH7WPUVmCNFkuPTJMhjVHFat9UntASMHJGZSUJEWY`
- Make sure the wallet has enough SKR and SOL for fees.
- A public RPC can rate limit or become unreliable. A private RPC is safer for repeated sends.
- Review the script before running with `--execute`.
