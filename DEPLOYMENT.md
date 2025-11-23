# Bob Bot Deployment Guide

This guide covers deploying Bob to various platforms.

## Prerequisites

1. **Bot Wallet Setup**
   ```bash
   # Generate wallet
   solana-keygen new -o bob-wallet.json

   # Get public address
   solana-keygen pubkey bob-wallet.json

   # Fund wallet (devnet)
   solana airdrop 1 <BOB_PUBLIC_ADDRESS> --url devnet

   # Or fund with real SOL (mainnet)
   solana transfer <BOB_PUBLIC_ADDRESS> 1.0 --url mainnet-beta
   ```

2. **Environment Variables**
   - Copy `.env.example` to `.env`
   - Fill in all required values
   - **NEVER** commit `.env` or wallet files to git!

## Deployment Options

### Option 1: Deno Deploy (Recommended for Deno)

```bash
# Install Deno Deploy CLI
deno install --allow-all --unstable https://deno.land/x/deploy/deployctl.ts

# Deploy
deployctl deploy --project=j1-blackjack-bob src/main.ts

# Set environment variables in Deno Deploy dashboard
# https://dash.deno.com/projects/j1-blackjack-bob/settings
```

**Pros:**
- Free tier available
- Native Deno support
- Automatic HTTPS
- Easy scaling

**Cons:**
- Learning data persists only in memory (unless using external storage)

### Option 2: Railway (Recommended for Docker)

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Create new project
railway init

# Deploy
railway up

# Set environment variables
railway variables set BOT_WALLET_PRIVATE_KEY="[...]"
railway variables set PLATFORM_WALLET="..."
# ... etc
```

**Environment Variables to Set:**
- `BOT_ENABLED=true`
- `CARD_COUNTING_ENABLED=true`
- `LEARNING_ENABLED=true`
- `BOT_WALLET_PRIVATE_KEY=[...]`
- `PLATFORM_URL=https://j1blackjack.com`
- `HELIUS_RPC_URL=https://api.devnet.solana.com`
- `ENTRY_FEE_SOL=0.05`
- `PLATFORM_WALLET=<your_platform_wallet>`

**Pros:**
- Free tier ($5/month credit)
- Persistent storage
- Easy environment management
- Automatic restarts

**Cons:**
- Requires credit card for free tier

### Option 3: Fly.io

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch app
fly launch

# Set secrets
fly secrets set BOT_WALLET_PRIVATE_KEY="[...]"
fly secrets set PLATFORM_WALLET="..."
# ... etc

# Deploy
fly deploy
```

**Pros:**
- Free tier (3 shared-cpu-1x VMs)
- Global edge network
- Persistent volumes available

**Cons:**
- More complex than Railway

### Option 4: VPS (DigitalOcean, Linode, etc.)

```bash
# SSH into VPS
ssh root@your-vps-ip

# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Clone repo
git clone https://github.com/YourUsername/j1-blackjack-bot.git
cd j1-blackjack-bot

# Create .env file
nano .env
# (paste your environment variables)

# Run with PM2 for auto-restart
npm install -g pm2
pm2 start --name bob-bot "deno run --allow-net --allow-env --allow-read --allow-write src/main.ts"
pm2 save
pm2 startup
```

**Pros:**
- Full control
- Persistent storage
- Can run multiple bots

**Cons:**
- Costs ~$5-10/month
- Manual server management

### Option 5: Docker Anywhere

```bash
# Build image
docker build -t j1-bob-bot .

# Run container
docker run -d \
  --name bob-bot \
  --restart unless-stopped \
  -e BOT_ENABLED=true \
  -e CARD_COUNTING_ENABLED=true \
  -e LEARNING_ENABLED=true \
  -e BOT_WALLET_PRIVATE_KEY="[...]" \
  -e PLATFORM_URL="https://j1blackjack.com" \
  -e HELIUS_RPC_URL="https://api.devnet.solana.com" \
  -e ENTRY_FEE_SOL=0.05 \
  -e PLATFORM_WALLET="..." \
  -v $(pwd)/data:/app/data \
  j1-bob-bot

# View logs
docker logs -f bob-bot

# Stop
docker stop bob-bot

# Start
docker start bob-bot
```

## Monitoring

### Check Logs

**Railway:**
```bash
railway logs
```

**Fly.io:**
```bash
fly logs
```

**Docker:**
```bash
docker logs -f bob-bot
```

**PM2:**
```bash
pm2 logs bob-bot
```

### Expected Output

```
═══════════════════════════════════════════
🤖 Bob Bot - J1 Blackjack Optimal Strategy
═══════════════════════════════════════════

Configuration:
  Platform: https://j1blackjack.com
  RPC: https://api.devnet.solana.com
  Entry Fee: 0.05 SOL
  Session Poll: 60000ms
  Game Poll: 2000ms

Features:
  Card Counting: ✅ ENABLED
  Learning: ✅ ENABLED
  Min Bet: 25 chips
  Max Bet: 100 chips

Initializing wallet...
Wallet: BobWallet123...
Balance: 1.2500 SOL

💰 Can play approximately 24 sessions

═══════════════════════════════════════════
🔍 Starting Session Monitor
═══════════════════════════════════════════

Bob will automatically join sessions with only 1 player
Checking lobby every 60 seconds...

[SessionMonitor] Checking 3 sessions...
[SessionMonitor] Found single-player session: abc123 (session #1012)
[BotWallet] Paying entry fee: 0.05 SOL to PlatformWallet...
[BotWallet] Payment confirmed: tx_abc123...
[SessionMonitor] ✅ Bob registered for session abc123
[GameClient] Starting session abc123
...
```

## Troubleshooting

### Bot not starting

**Check environment variables:**
```bash
# Railway
railway variables

# Fly.io
fly secrets list

# Docker
docker exec bob-bot env
```

**Check wallet balance:**
```bash
solana balance <BOB_WALLET_ADDRESS> --url devnet
```

### Bot registered but not playing

- Check platform API is accessible
- Verify wallet signatures are working
- Check game-action API endpoint

### Learning data not persisting

**Railway/Fly.io:**
- Add persistent volume
- Mount to `/app/data`

**Docker:**
```bash
# Use volume mount
-v $(pwd)/data:/app/data
```

### Out of funds

**Check balance:**
```bash
solana balance <BOB_WALLET_ADDRESS>
```

**Refund:**
```bash
solana transfer <BOB_WALLET_ADDRESS> 0.5
```

## Scaling

### Multiple Bots

You can run multiple Bob instances with different wallets:

```bash
# Bot 1 (Bob)
BOT_WALLET_PRIVATE_KEY="[bob_key]" deno task start

# Bot 2 (Alice)
BOT_WALLET_PRIVATE_KEY="[alice_key]" deno task start
```

### Auto-Refund

Set up cron job to refund Bob when balance is low:

```bash
# Check every hour, refund if < 0.1 SOL
0 * * * * /path/to/refund-bob.sh
```

## Cost Analysis

### Hosting Costs

| Platform | Free Tier | Paid Tier |
|----------|-----------|-----------|
| Deno Deploy | 100K requests/day | $10/month |
| Railway | $5 credit/month | $5/month after |
| Fly.io | 3 shared VMs | $5-10/month |
| VPS | None | $5-10/month |

### Bot Operation Costs

```
Entry Fees: 100 sessions × 0.05 SOL = 5 SOL/month
Win Rate: 55% (with learning + counting)
Winnings: 55 × 0.075 SOL = 4.125 SOL/month
Net Cost: 5 - 4.125 = 0.875 SOL/month (~$175 at $200/SOL)

Platform Revenue: 100 × 0.01 SOL = 1 SOL/month
Net Profit: 1.0 - 0.875 = +0.125 SOL/month (+$25/month)
```

**Total Monthly Cost:**
- Hosting: $0-10
- Bot Operations: -$25 (profit!)
- **Net: Profitable after learning!**

## Security Checklist

- [ ] Bot wallet private key stored securely (environment variables)
- [ ] `.env` file not committed to git
- [ ] Wallet files (*.json) not committed to git
- [ ] Separate bot wallet from treasury/vault wallets
- [ ] Bot wallet limited to 1-2 SOL (minimize risk)
- [ ] Monitoring/alerts set up
- [ ] Logs reviewed regularly

## Maintenance

### Weekly
- Check bot balance
- Review learning stats
- Check win rate trend

### Monthly
- Export learning data for analysis
- Review opponent profiles
- Adjust bet sizing if needed
- Update strategy if performance declines

### Quarterly
- Audit total costs vs revenue
- Consider scaling (more bots)
- Review and update dependencies
