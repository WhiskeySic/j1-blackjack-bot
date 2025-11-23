/**
 * Bob 🤖 - J1 Blackjack Optimal Strategy Bot
 *
 * Main entry point for the bot service.
 * Monitors sessions and automatically joins when only 1 player is registered.
 */

import { SessionMonitor } from "./services/SessionMonitor.ts";
import { BotWallet } from "./services/BotWallet.ts";
import { config } from "./config.ts";
import { logger } from "./utils/logger.ts";

async function main() {
  logger.info("═══════════════════════════════════════════");
  logger.info("🤖 Bob Bot - J1 Blackjack Optimal Strategy");
  logger.info("═══════════════════════════════════════════");
  logger.info("");

  // Check if bot is enabled
  if (!config.botEnabled) {
    logger.warn("⚠️  BOT_ENABLED=false - Bot is disabled");
    logger.info("Set BOT_ENABLED=true in .env to enable");
    return;
  }

  // Display configuration
  logger.info("Configuration:");
  logger.info(`  Platform: ${config.platformUrl}`);
  logger.info(`  RPC: ${config.heliusRpcUrl}`);
  logger.info(`  Entry Fee: ${config.entryFeeSol} SOL`);
  logger.info(`  Session Poll: ${config.sessionPollIntervalMs}ms`);
  logger.info(`  Game Poll: ${config.gameStatePollIntervalMs}ms`);
  logger.info("");

  logger.info("Features:");
  logger.info(`  Card Counting: ${config.cardCountingEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  logger.info(`  Learning: ${config.learningEnabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  logger.info(`  Min Bet: ${config.minBet} chips`);
  logger.info(`  Max Bet: ${config.maxBet} chips`);
  logger.info("");

  // Initialize bot wallet
  logger.info("Initializing wallet...");
  const botWallet = new BotWallet(
    config.botWalletPrivateKey,
    config.heliusRpcUrl
  );

  await botWallet.initialize();

  const balance = await botWallet.getBalance();
  logger.info(`Wallet: ${botWallet.getPublicKey()}`);
  logger.info(`Balance: ${balance.toFixed(4)} SOL`);
  logger.info("");

  // Check sufficient balance
  const minRequired = config.entryFeeSol + 0.01;
  if (balance < minRequired) {
    logger.error(`❌ Insufficient balance!`);
    logger.error(`   Current: ${balance.toFixed(4)} SOL`);
    logger.error(`   Required: ${minRequired.toFixed(4)} SOL`);
    logger.error("");
    logger.error("Please fund the bot wallet:");
    logger.error(`   solana transfer ${botWallet.getPublicKey()} 1.0 --url ${config.heliusRpcUrl.includes('devnet') ? 'devnet' : 'mainnet-beta'}`);
    Deno.exit(1);
  }

  // Estimate how many sessions can be played
  const sessionsAvailable = Math.floor((balance - 0.01) / config.entryFeeSol);
  logger.info(`💰 Can play approximately ${sessionsAvailable} sessions`);
  logger.info("");

  // Start session monitor
  logger.info("═══════════════════════════════════════════");
  logger.info("🔍 Starting Session Monitor");
  logger.info("═══════════════════════════════════════════");
  logger.info("");
  logger.info("Bob will automatically join sessions with only 1 player");
  logger.info(`Checking lobby every ${config.sessionPollIntervalMs / 1000} seconds...`);
  logger.info("");

  const monitor = new SessionMonitor(
    config.platformUrl,
    botWallet,
    config.sessionPollIntervalMs
  );

  // Graceful shutdown
  Deno.addSignalListener("SIGINT", () => {
    logger.info("");
    logger.info("🛑 Shutting down gracefully...");
    monitor.stop();
    Deno.exit(0);
  });

  await monitor.start();
}

// Run bot
if (import.meta.main) {
  main().catch((error) => {
    logger.error("");
    logger.error("═══════════════════════════════════════════");
    logger.error("❌ Fatal Error");
    logger.error("═══════════════════════════════════════════");
    logger.error(error);
    Deno.exit(1);
  });
}
