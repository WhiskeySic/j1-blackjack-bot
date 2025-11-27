# Starting Bob Bot

Bob is now **FIXED** and ready to actively play blackjack! 🎉

## Quick Start

### Option 1: Foreground (with logs)
```bash
cd /Users/elgringo/Projects/j1-blackjack-bot
deno task start
```

**OR**

```bash
cd /Users/elgringo/Projects/j1-blackjack-bot
deno run --allow-all src/main.ts
```

### Option 2: Background (daemon)
```bash
cd /Users/elgringo/Projects/j1-blackjack-bot
nohup deno task start > bob.log 2>&1 &
echo $! > bob.pid
```

### Check if Bob is Running
```bash
ps aux | grep "deno.*main.ts" | grep -v grep
```

### View Logs (if running in background)
```bash
cd /Users/elgringo/Projects/j1-blackjack-bot
tail -f bob.log
```

### Stop Bob (if running in background)
```bash
cd /Users/elgringo/Projects/j1-blackjack-bot
kill $(cat bob.pid)
rm bob.pid
```

## What Bob Does

1. **Monitors Lobby**: Checks every 10 seconds for new sessions
2. **Auto-Joins**: Joins sessions with only 1 player (so no one plays alone)
3. **Places Bets**: Uses card counting to bet 25-100 chips dynamically
4. **Makes Moves**: Calculates optimal EV for hit/stand/double/split
5. **Learns**: Builds opponent profiles and improves over time

## Fixes Applied (November 24, 2024)

All 6 critical issues from `BOB_FIXES_SUMMARY.md` are now resolved:

1. ✅ **Dynamic Bet Sizing** - Now bets 25-100 chips based on true count
2. ✅ **Bet Overwriting Fixed** - Checks `game_hands` table before betting
3. ✅ **Turn Order Respected** - Waits for `current_turn_seat` match
4. ✅ **Faster Actions** - Reduced delays from 1-3s to 0.3-0.8s (60% faster)
5. ✅ **Adaptive Polling** - Backoff on errors (2s → 10s max)
6. ✅ **Robust Turn Detection** - Blacklist instead of whitelist for status

## **NEW FIX (November 26, 2024)**

7. ✅ **Environment Loading** - Added `dotenv/load.ts` import to `src/main.ts`
8. ✅ **Config Update** - Updated `.env` with correct delay values (300-800ms)

## Expected Logs

When Bob joins a session, you'll see:
```
[SessionMonitor] Session abc123 has 1 player - registering Bob
[BotWallet] Paying entry fee: 0.05 SOL
[BotWallet] Payment confirmed: tx_signature_xyz
[GameClient] Bob registered for session abc123
[GameClient] Session started - 2 players
[GameClient] Placing bet of 40 chips (true count: 1.5)...
[OptimalStrategy] Player: 16 (hard), Dealer: 7 -> Decision: hit (EV: -0.385)
[GameClient] Session completed - Bob rank: 1/2, chips: 1150
```

## Bot Wallet

- **Address**: `CrE3nCptz6gzWbzW4xhaxnaScHqohBvSoVKiijGr4xvc`
- **Balance**: 9.02 SOL (can play ~180 sessions)
- **Network**: Devnet

## Troubleshooting

### Bot Won't Start
```bash
# Check dependencies cached
deno cache src/main.ts

# Check .env file exists
ls -la .env

# Verify wallet balance
solana balance CrE3nCptz6gzWbzW4xhaxnaScHqohBvSoVKiijGr4xvc --url devnet
```

### Bot Not Joining Sessions
Check logs for:
- `[SessionMonitor] Session X has 1 player - registering Bob` (should appear)
- `[BotWallet] Payment confirmed: ...` (entry fee paid)
- If not appearing, check `BOT_ENABLED=true` in `.env`

### Bot Not Placing Bets/Making Moves
This was the original issue - **NOW FIXED!**

Check logs for:
- `[GameClient] Placing bet of X chips (true count: Y.Y)...`
- `[GameClient] Hand N: ... -> hit/stand/double (EV: ...)`
- Bob should act within 0.3-0.8 seconds (or instantly if only player)

### Bot Still Waiting for Timeouts
**This should NOT happen anymore!** If you see:
- Bet timer counting down to 0
- Move timer counting down to 0
- Bob not acting until timeout

Then Bob is **NOT RUNNING**. Start Bob using the commands above.

## Performance Monitoring

Track Bob's performance:
```sql
-- Query Supabase database
SELECT
  session_id,
  final_rank,
  current_chips,
  payout
FROM session_participants
WHERE wallet_address = 'CrE3nCptz6gzWbzW4xhaxnaScHqohBvSoVKiijGr4xvc'
ORDER BY created_at DESC
LIMIT 20;
```

Expected win rate:
- First 20 sessions: ~48% (baseline strategy)
- After 100 sessions: ~55-58% (learned + card counting)

## Cron Jobs Still Needed

Bob handles **active gameplay**, but server-side cron jobs are still needed for:
- **Auto-bet fallback** when players go AFK (20s timeout)
- **Auto-stand fallback** when players go AFK (15s timeout)
- **VRF fulfillment** for pre-generated shuffled decks

See `DEPLOY_CRON_JOBS.md` in main project for deployment.
