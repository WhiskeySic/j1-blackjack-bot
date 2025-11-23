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
  logger.info("🤖 Bob Bot Starting...");
  logger.info(`Platform: ${config.platformUrl}`);
  logger.info(`RPC: ${config.heliusRpcUrl}`);

  // Initialize bot wallet
  const botWallet = new BotWallet(
    config.botWalletPrivateKey,
    config.heliusRpcUrl
  );

  await botWallet.initialize();

  const balance = await botWallet.getBalance();
  logger.info(`Bot Wallet: ${botWallet.getPublicKey()}`);
  logger.info(`Balance: ${balance} SOL`);

  if (balance < config.entryFeeSol + 0.01) {
    logger.error(`Insufficient balance! Need at least ${config.entryFeeSol + 0.01} SOL`);
    Deno.exit(1);
  }

  // Start session monitor
  const monitor = new SessionMonitor(
    config.platformUrl,
    botWallet,
    config.sessionPollIntervalMs
  );

  logger.info(`Starting session monitor (poll interval: ${config.sessionPollIntervalMs}ms)`);
  await monitor.start();
}

// Run bot
if (import.meta.main) {
  main().catch((error) => {
    logger.error("Fatal error:", error);
    Deno.exit(1);
  });
}
