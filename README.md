# Bob 🤖 - J1 Blackjack Optimal Strategy Bot

An external bot service that automatically joins single-player J1 Blackjack tournament sessions to ensure every session has at least 2 competitors.

## Features

- **Optimal Strategy**: Uses statistical win probability calculations (EV-based decisions)
- **Card Counting**: Hi-Lo counting system with dynamic bet sizing (toggleable)
- **Machine Learning**: Learns from every session, builds opponent profiles, improves over time (toggleable)
- **Auto-Registration**: Monitors lobby and joins sessions with only 1 player
- **Wallet Management**: Pays entry fees (0.05 SOL) from dedicated bot wallet
- **Human-like Behavior**: Random action delays (1-3s) to appear natural
- **Zero Platform Dependencies**: Uses only public APIs - acts like a regular player

## Architecture

```
Bob Bot Service (Deno/Node.js)
├── SessionMonitor - Polls /api/lobby-sessions every 60s
├── BotWallet - Manages Solana wallet operations
├── GameClient - Polls game state every 2s when in active session
├── OptimalStrategy - EV-based decision engine
└── ActionExecutor - Calls platform APIs with wallet signatures
```

## Strategy

Bob doesn't use fixed Basic Strategy rules. Instead, he calculates Expected Value (EV) for each possible action:

- **Hit**: Recursive simulation of outcomes with 8-deck shoe probabilities
- **Stand**: Win probability vs dealer's final distribution
- **Double**: Single-card EV with doubled bet
- **Split**: Optimal play for each split hand

Bob always chooses the action with highest EV.

## Setup

### 1. Create Bot Wallet

```bash
# Generate new Solana wallet for Bob
solana-keygen new -o bob-wallet.json

# Get public address
solana-keygen pubkey bob-wallet.json

# Fund wallet (devnet)
solana airdrop 1 <BOB_PUBLIC_ADDRESS> --url devnet

# Or fund with real SOL (mainnet)
solana transfer <BOB_PUBLIC_ADDRESS> 1.0 --url mainnet-beta
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Bot wallet private key (base58 or JSON array)
BOT_WALLET_PRIVATE_KEY=[1,2,3,...]  # from bob-wallet.json

# Platform configuration
PLATFORM_URL=https://j1blackjack.com
HELIUS_RPC_URL=https://api.devnet.solana.com
ENTRY_FEE_SOL=0.05
PLATFORM_WALLET=<platform_treasury_wallet>

# Monitoring
SESSION_POLL_INTERVAL_MS=60000  # 60 seconds
GAME_STATE_POLL_INTERVAL_MS=2000  # 2 seconds
ACTION_DELAY_MIN_MS=1000  # 1 second
ACTION_DELAY_MAX_MS=3000  # 3 seconds

# Logging
LOG_LEVEL=info
```

### 3. Install Dependencies

```bash
# For Deno
deno cache src/main.ts

# Or for Node.js
npm install
```

### 4. Run Bot

```bash
# Deno
deno run --allow-net --allow-env --allow-read src/main.ts

# Or Node.js
npm start
```

## Deployment

### Option 1: Deno Deploy (Recommended)

```bash
# Install Deno Deploy CLI
deno install --allow-all --unstable https://deno.land/x/deploy/deployctl.ts

# Deploy
deployctl deploy --project=j1-blackjack-bot src/main.ts
```

Add environment variables in Deno Deploy dashboard.

### Option 2: Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Option 3: Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Initialize and deploy
fly launch
fly deploy
```

### Option 4: Docker (any VPS)

```bash
docker build -t j1-bot .
docker run -d --env-file .env j1-bot
```

## Monitoring

Bob logs all activity:

```
[SessionMonitor] Checking lobby... 3 active sessions
[SessionMonitor] Session abc123 has 1 player - registering Bob
[BotWallet] Paying entry fee: 0.05 SOL
[BotWallet] Payment confirmed: tx_signature_xyz
[GameClient] Bob registered for session abc123
[GameClient] Session started - 2 players
[OptimalStrategy] Player: 16 (hard), Dealer: 7 -> Decision: hit (EV: -0.385)
[ActionExecutor] Action executed: hit
[GameClient] Session completed - Bob rank: 2/2, chips: 850
```

## Economics

Assuming 100 single-player sessions per month:

### Without Learning (First 20 Sessions)
```
Bot Entry Fees: 100 × 0.05 SOL = 5 SOL
Bot Win Rate: ~48% (baseline optimal strategy)
Bot Winnings: 48 × 0.075 SOL = 3.6 SOL returned
Net House Cost: 5 - 3.6 = 1.4 SOL/month (~$280/month at $200/SOL)

Platform Revenue: 100 × 0.010 SOL = 1 SOL ($200/month)
Net Cost to Subsidize: 1.4 - 1.0 = 0.4 SOL/month (~$80/month)
```

### With Learning + Card Counting (After 100 Sessions)
```
Bot Entry Fees: 100 × 0.05 SOL = 5 SOL
Bot Win Rate: ~55-58% (learned strategy + card counting)
Bot Winnings: 56 × 0.075 SOL = 4.2 SOL returned
Net House Cost: 5 - 4.2 = 0.8 SOL/month (~$160/month at $200/SOL)

Platform Revenue: 100 × 0.010 SOL = 1 SOL ($200/month)
Net Profit: 1.0 - 0.8 = +0.2 SOL/month (+$40/month profit!)
```

**Bob becomes self-sustaining after learning!** 🎉

## Security

- ✅ Bot wallet private key stored in environment (never in code)
- ✅ Separate from platform treasury/vault wallets
- ✅ Uses same VRF-shuffled deck as humans (no card knowledge)
- ✅ All actions logged and auditable
- ✅ Bob clearly labeled as 🤖 in UI

## License

MIT
