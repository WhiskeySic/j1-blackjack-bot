# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bob 🤖 is an external bot service for J1 Blackjack that automatically joins single-player tournament sessions. Bob uses optimal strategy, card counting, and machine learning to compete against human players.

**Key Architecture**: This is a standalone Node.js/Deno application that uses only public APIs - it does NOT run inside the platform codebase.

## Technology Stack

### Runtime
- **Deno** - Primary runtime (v1.40+)
- **TypeScript** - All source code
- **Solana Web3.js** - Blockchain wallet operations

### Core Technologies
- **Solana Blockchain** - Wallet management, entry fee payments
- **REST API Client** - Platform API communication
- **File-based Storage** - JSON persistence for learning data

### External Dependencies
- `@solana/web3.js@1.98.2` - Solana Web3 client
- `bs58@6.0.0` - Base58 encoding for wallet keys

## Common Commands

### Development
```bash
# Start bot locally
deno task start

# Start with auto-reload (development)
deno task dev

# Run with full permissions manually
deno run --allow-net --allow-env --allow-read --allow-write src/main.ts
```

### Docker
```bash
# Build Docker image
docker build -t bob-bot .

# Run container
docker run -d \
  --name bob-bot \
  --restart unless-stopped \
  -e BOT_ENABLED=true \
  -e CARD_COUNTING_ENABLED=true \
  -e LEARNING_ENABLED=true \
  -e BOT_WALLET_PRIVATE_KEY="[...]" \
  -e PLATFORM_URL="https://j1blackjack.com" \
  -v $(pwd)/data:/app/data \
  bob-bot

# View logs
docker logs -f bob-bot

# Stop/start
docker stop bob-bot
docker start bob-bot
```

### Deployment
```bash
# Deploy to Railway
railway up

# Deploy to Fly.io
fly launch
fly deploy

# Deploy to Deno Deploy
deployctl deploy --project=j1-blackjack-bob src/main.ts
```

## Architecture & Code Organization

### Project Structure
```
j1-blackjack-bot/
├── src/
│   ├── main.ts                     # Entry point, startup flow
│   ├── config.ts                   # Environment variable management
│   ├── types.ts                    # TypeScript type definitions
│   ├── utils/
│   │   └── logger.ts              # Logging utility
│   ├── strategy/
│   │   ├── CardCounter.ts         # Hi-Lo card counting
│   │   └── OptimalStrategy.ts     # EV-based decision engine
│   ├── learning/
│   │   ├── OpponentProfiler.ts    # Opponent behavioral tracking
│   │   ├── ExperienceTracker.ts   # Hand/session recording
│   │   ├── MemoryManager.ts       # Persistent storage
│   │   └── LearningCoordinator.ts # Learning orchestration
│   └── services/
│       ├── BotWallet.ts           # Solana wallet management
│       ├── SessionMonitor.ts      # Lobby polling, registration
│       └── GameClient.ts          # Gameplay loop
├── data/
│   └── bob-memory.json            # Learning data (generated)
├── .env.example                    # Configuration template
├── Dockerfile                      # Docker deployment
├── deno.json                       # Deno tasks
├── railway.json                    # Railway config
├── fly.toml                        # Fly.io config
└── [documentation files]
```

### Key Components

#### 1. Main Entry Point (`src/main.ts`)
- Startup sequence: config display → wallet init → balance check → session monitor
- Graceful shutdown on SIGINT
- Beautiful CLI interface with status messages

#### 2. Session Monitor (`src/services/SessionMonitor.ts`)
- Polls `/api/lobby-sessions` every 60 seconds
- Detects sessions with exactly 1 player
- Calls `BotWallet.payEntryFee()` then platform's `/api/register-participant`
- Spawns `GameClient` for active gameplay
- Tracks registered sessions to prevent duplicates

#### 3. Game Client (`src/services/GameClient.ts`)
- Main gameplay loop (polls `/api/game-state/:sessionId` every 2 seconds)
- **Betting Phase**: Calls `OptimalStrategy.getDecision()` for bet size
- **Action Phase**: Calculates optimal action, applies learning adjustments
- Observes all cards for card counting
- Records experiences for learning system
- Handles session completion and result analysis

#### 4. Optimal Strategy (`src/strategy/OptimalStrategy.ts`)
- Calculates Expected Value (EV) for hit, stand, double, split
- Uses pre-calculated dealer bust probabilities
- Recursive hit simulation (depth limit 5)
- Integrates with `CardCounter` for strategy modifiers
- Returns `BotDecision` with action, confidence, EV, betSize

#### 5. Card Counter (`src/strategy/CardCounter.ts`)
- Hi-Lo counting system (2-6: +1, 7-9: 0, 10-A: -1)
- Calculates running count and true count
- Dynamic bet sizing: 25 chips (min) to 100 chips (max) based on true count
- Insurance recommendations (TC >= 3)
- Toggleable via `CARD_COUNTING_ENABLED`

#### 6. Learning System
- **OpponentProfiler**: Tracks behavioral patterns, skill/aggression scores, weaknesses
- **ExperienceTracker**: Records last 1000 hands, last 100 sessions
- **MemoryManager**: Saves/loads `./data/bob-memory.json`, CSV export
- **LearningCoordinator**: Orchestrates all learning components, generates insights

#### 7. Bot Wallet (`src/services/BotWallet.ts`)
- Initializes wallet from `BOT_WALLET_PRIVATE_KEY` (JSON array or base58)
- Balance checking with `getBalance()`
- Entry fee payments via Solana `SystemProgram.transfer()`
- Returns transaction signatures for registration

## Key Architectural Concepts

### Game Flow
1. **Startup**: Load config → init wallet → check balance → start monitor
2. **Monitoring**: Poll lobby → detect single-player session → register + pay
3. **Gameplay**: Poll game state → betting phase → action phase → completion
4. **Learning**: Record hand → update opponent profiles → save memory

### Platform API Endpoints Used
- `GET /api/lobby-sessions` - Fetch active sessions
- `POST /api/register-participant` - Register for session
- `GET /api/game-state/:sessionId` - Get current game state
- `POST /api/game-action` - Execute action (bet, hit, stand, double, split)
- `GET /api/session-results/:sessionId` - Get final results

### Decision Making Process
```typescript
// 1. Get game situation
const situation: GameSituation = {
  playerHand, playerTotal, isSoft,
  dealerUpcard, trueCount, chipStack,
  currentRank, handsRemaining,
  canDouble, canSplit
};

// 2. Get learning adjustment (if enabled)
const learningAdj = learning.getStrategyAdjustment(playerTotal, dealerRank, action);

// 3. Calculate optimal decision with card counting
const decision = strategy.getDecision(situation, learningAdj);
// Returns: { action, confidence, expectedValue, betSize }

// 4. Adjust based on opponents (if learning enabled)
const finalDecision = learning.adjustDecisionForOpponent(decision, opponentWallets);

// 5. Execute with random delay (1-3s)
await randomDelay();
await executeAction(finalDecision.action);
```

### Learning Data Flow
```typescript
// Every hand:
experienceTracker.recordHand({
  sessionId, handNumber,
  playerHand, dealerUpcard,
  actionTaken, betSize,
  handResult, chipsWon,
  trueCount, opponentWallets
});

// Every session:
await learningCoordinator.recordSession(sessionResult, bobRank);
// → Updates opponent profiles
// → Calculates performance metrics
// → Generates insights
// → Saves to disk
```

## Critical Constants

### Configuration (from `.env`)
```typescript
BOT_ENABLED = true                  // Master on/off switch
CARD_COUNTING_ENABLED = true        // Enable card counting
LEARNING_ENABLED = true             // Enable learning system

PLATFORM_URL = "https://j1blackjack.com"
HELIUS_RPC_URL = "https://api.devnet.solana.com"
ENTRY_FEE_SOL = 0.05
PLATFORM_WALLET = "<treasury_wallet>"

SESSION_POLL_INTERVAL_MS = 60000    // 60 seconds
GAME_STATE_POLL_INTERVAL_MS = 2000  // 2 seconds

ACTION_DELAY_MIN_MS = 1000          // 1 second
ACTION_DELAY_MAX_MS = 3000          // 3 seconds

MIN_BET = 25                        // Chips
MAX_BET = 100                       // Chips
COUNT_THRESHOLD_BET_INCREASE = 2    // True count threshold
```

### Strategy Constants
```typescript
// Card counting (8-deck shoe)
TOTAL_CARDS = 416
CARDS_PER_RANK = 32 (except 10s: 128)

// Dealer bust probabilities (pre-calculated)
DEALER_BUST_PROB = {
  2: 0.3539, 3: 0.3745, 4: 0.4002,
  5: 0.4282, 6: 0.4205, 7: 0.2619,
  8: 0.2383, 9: 0.2301, 10: 0.2129, A: 0.1178
}

// Learning limits
MAX_EXPERIENCES = 1000  // Last 1000 hands
MAX_SESSIONS = 100      // Last 100 sessions
```

## Environment Variables

### Required
```bash
BOT_WALLET_PRIVATE_KEY="[...]"      # Solana wallet secret key
PLATFORM_WALLET="<address>"         # Platform treasury wallet
```

### Optional (with defaults)
```bash
BOT_ENABLED="true"
CARD_COUNTING_ENABLED="true"
LEARNING_ENABLED="true"
PLATFORM_URL="https://j1blackjack.com"
HELIUS_RPC_URL="https://api.devnet.solana.com"
ENTRY_FEE_SOL="0.05"
SESSION_POLL_INTERVAL_MS="60000"
GAME_STATE_POLL_INTERVAL_MS="2000"
ACTION_DELAY_MIN_MS="1000"
ACTION_DELAY_MAX_MS="3000"
MIN_BET="25"
MAX_BET="100"
COUNT_THRESHOLD_BET_INCREASE="2"
LOG_LEVEL="info"
```

## Development Workflow

### After Cloning
1. `cp .env.example .env` - Create environment file
2. Edit `.env` with your configuration
3. Create bot wallet: `solana-keygen new -o bob-wallet.json`
4. Fund wallet: `solana airdrop 1 <BOB_ADDRESS> --url devnet`
5. `deno task start` - Run bot locally

### Making Changes

#### Modify Strategy
1. Edit `src/strategy/OptimalStrategy.ts`
2. Adjust EV calculations in `calculateStandEV()`, `calculateHitEV()`, etc.
3. Test with `deno task start`

#### Modify Card Counting
1. Edit `src/strategy/CardCounter.ts`
2. Adjust `updateCount()` for different counting systems
3. Modify `getBet()` for different betting spreads

#### Modify Learning
1. **Opponent Profiling**: Edit `src/learning/OpponentProfiler.ts`
2. **Experience Tracking**: Edit `src/learning/ExperienceTracker.ts`
3. **Memory Format**: Edit `src/learning/MemoryManager.ts`
4. **Insights**: Edit `src/learning/LearningCoordinator.ts`

#### Add New Features
1. Add types to `src/types.ts`
2. Implement feature in appropriate service/strategy file
3. Update `src/config.ts` for new env variables
4. Update `.env.example` with new variables
5. Document in README.md

### Testing

#### Local Testing
```bash
# Start bot with debug logging
LOG_LEVEL=debug deno task start

# Monitor logs for:
# - Session detection
# - Registration success
# - Bet sizes (check card counting)
# - Action decisions (check EV calculations)
# - Learning insights (check opponent profiling)
```

#### Docker Testing
```bash
# Build and run
docker build -t bob-bot .
docker run --env-file .env bob-bot

# Check logs
docker logs -f bob-bot
```

## Deployment Checklist

### Pre-Deployment
- [ ] Create bot wallet and fund with SOL
- [ ] Set all environment variables in platform
- [ ] Test locally with `deno task start`
- [ ] Verify bot can connect to platform APIs
- [ ] Check wallet has sufficient balance

### Deployment
- [ ] Deploy to chosen platform (Railway/Fly.io/etc)
- [ ] Set environment variables in platform dashboard
- [ ] Verify bot starts without errors
- [ ] Monitor logs for session detection
- [ ] Confirm bot can register and play

### Post-Deployment
- [ ] Monitor wallet balance
- [ ] Review learning data after 10 sessions
- [ ] Check win rate matches expectations (~48-58%)
- [ ] Export CSV for analysis
- [ ] Adjust bet sizing if needed

## Troubleshooting

### Bot Won't Start
- **Check**: `.env` file exists and has all required variables
- **Check**: `BOT_WALLET_PRIVATE_KEY` format (JSON array or base58)
- **Check**: Wallet has sufficient balance (>0.06 SOL)
- **Fix**: Run with `LOG_LEVEL=debug` to see detailed errors

### Bot Not Registering for Sessions
- **Check**: `PLATFORM_URL` is correct
- **Check**: Lobby API is accessible: `curl $PLATFORM_URL/api/lobby-sessions`
- **Check**: Wallet has SOL for entry fees
- **Check**: No other bot is already registered for session

### Bot Registered But Not Playing
- **Check**: Game state API is accessible
- **Check**: Wallet address matches between registration and game state
- **Check**: Session actually started (not stuck in registration)
- **Check**: No timeout errors in logs

### Learning Data Not Saving
- **Check**: `LEARNING_ENABLED=true`
- **Check**: `./data/` directory exists and is writable
- **Check**: No permission errors in logs
- **Check**: Disk space available

### Bad Strategy Decisions
- **Check**: Card counting is enabled (if using counting)
- **Check**: `CardCounter.observeCard()` is called for all cards
- **Check**: EV calculations in `OptimalStrategy` are correct
- **Check**: Learning adjustments aren't too aggressive

## Key Files to Modify

When adding features:

### New Strategy Logic
- `src/strategy/OptimalStrategy.ts` - EV calculations
- `src/strategy/CardCounter.ts` - Counting system

### New Learning Features
- `src/learning/OpponentProfiler.ts` - Behavioral tracking
- `src/learning/ExperienceTracker.ts` - Data collection
- `src/learning/LearningCoordinator.ts` - Orchestration

### New Platform Integration
- `src/services/SessionMonitor.ts` - Session detection
- `src/services/GameClient.ts` - Gameplay loop
- `src/services/BotWallet.ts` - Wallet operations

### Configuration Changes
- `src/config.ts` - Add new env variables
- `.env.example` - Document new variables
- `src/types.ts` - Add new type definitions

## Documentation References

### Core Docs
- **README.md** - Main documentation, setup, features
- **LEARNING_SYSTEM.md** - Learning system deep dive
- **DEPLOYMENT.md** - Platform-specific deployment guides
- **SUMMARY.md** - Complete implementation overview
- **CLAUDE.md** - This file

### External Resources
- Solana Web3.js: https://solana-labs.github.io/solana-web3.js/
- Deno Manual: https://deno.land/manual
- Blackjack Basic Strategy: https://wizardofodds.com/games/blackjack/strategy/

## Performance Expectations

### Win Rates
- **Baseline (optimal strategy only)**: 48-50%
- **With card counting**: 52-55%
- **With learning (100+ sessions)**: 55-58%
- **Expert mode (500+ sessions)**: 58-62%

### Economics (per 100 sessions)
- **Entry fees**: 5 SOL
- **Expected winnings (56% win rate)**: 4.2 SOL
- **Net cost**: 0.8 SOL (~$160/month at $200/SOL)
- **Platform revenue**: 1.0 SOL
- **Net profit**: +0.2 SOL (+$40/month)

## Security Notes

### Wallet Security
- Private key stored in environment variables only
- Never log private keys
- Separate bot wallet from treasury/vault
- Limit bot wallet to 1-2 SOL max

### Code Security
- No eval() or dynamic code execution
- Environment variables validated on startup
- All API responses validated
- Graceful error handling

### Data Privacy
- Wallet addresses anonymized in logs (first 8 chars only)
- Learning data stored locally only
- CSV exports contain no private keys
- Can be disabled with `LEARNING_ENABLED=false`

## Common Tasks

### View Learning Stats
```typescript
const stats = learning.getStats();
console.log(stats);
// {
//   totalSessions: 150,
//   totalHands: 1500,
//   overallWinRate: 0.54,
//   avgRank: 1.8,
//   opponentProfiles: 47
// }
```

### Export Learning Data
```bash
# Automatic CSV export after each session
# Files created in ./data/
# - bob-sessions.csv
# - bob-opponents.csv
```

### Reset Learning Data
```bash
# Delete memory file
rm data/bob-memory.json

# Bot will start fresh on next run
```

### Change Bet Sizing
```bash
# Edit .env
MIN_BET=50
MAX_BET=200
COUNT_THRESHOLD_BET_INCREASE=3

# Restart bot
```

### Disable Features
```bash
# Disable card counting
CARD_COUNTING_ENABLED=false

# Disable learning
LEARNING_ENABLED=false

# Disable bot entirely
BOT_ENABLED=false
```

## Path Aliases

This project uses standard Deno import paths:
- Relative imports: `./filename.ts` or `../folder/filename.ts`
- External dependencies: `https://esm.sh/package@version`
- No path aliases configured

## Git Workflow

### Important Files to NEVER Commit
- `.env` - Environment variables
- `*.json` (except config files) - Wallet files
- `data/bob-memory.json` - Learning data
- `bob-wallet.json` - Wallet private key

### Safe to Commit
- Source code (`src/**/*.ts`)
- Configuration templates (`.env.example`)
- Documentation (`*.md`)
- Deployment configs (`Dockerfile`, `railway.json`, `fly.toml`)
- `data/.gitkeep` (empty placeholder)

## License

MIT
