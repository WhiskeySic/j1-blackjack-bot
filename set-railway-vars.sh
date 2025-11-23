#!/bin/bash

# Railway Environment Variables Setup Script
# Run this after linking to your Railway service with: railway service

echo "Setting Railway environment variables for Bob..."

railway variables \
  --set "BOT_ENABLED=true" \
  --set "CARD_COUNTING_ENABLED=true" \
  --set "LEARNING_ENABLED=true" \
  --set "PLATFORM_URL=https://vosmzvomrujduyjugnwa.supabase.co/functions/v1" \
  --set "HELIUS_RPC_URL=https://api.devnet.solana.com" \
  --set "ENTRY_FEE_SOL=0.05" \
  --set "PLATFORM_WALLET=7ebkMKveJLpHbdyq5ZsxmRTotuyeqvEb2avxutVo2UCe" \
  --set "BOT_WALLET_PRIVATE_KEY=5t16pN2H9pqPVN1ptvLfutUqw4ZxK9HLF7iuvWS6mmCrQYkCeekXmCpH16pCWazyuKrJYQw7GCr3RZtT96YYP8kG" \
  --set "SESSION_POLL_INTERVAL_MS=60000" \
  --set "GAME_STATE_POLL_INTERVAL_MS=2000" \
  --set "ACTION_DELAY_MIN_MS=1000" \
  --set "ACTION_DELAY_MAX_MS=3000" \
  --set "MIN_BET=25" \
  --set "MAX_BET=100" \
  --set "COUNT_THRESHOLD_BET_INCREASE=2" \
  --set "LOG_LEVEL=info"

echo ""
echo "✓ Environment variables set successfully!"
echo ""
echo "Next steps:"
echo "1. Check deployment status: railway status"
echo "2. View logs: railway logs"
echo "3. Check deployment URL: https://railway.com/project/f0b5b311-ae07-41d8-af7e-f4d77c107ca3"
