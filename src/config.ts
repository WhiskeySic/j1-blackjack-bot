/**
 * Configuration for Bob Bot
 *
 * Environment variables control bot behavior and features.
 */

export interface Config {
  // Bot Control
  botEnabled: boolean;              // Master on/off switch for bot
  cardCountingEnabled: boolean;     // Enable/disable card counting feature
  learningEnabled: boolean;         // Enable/disable learning system

  // Platform
  platformUrl: string;
  heliusRpcUrl: string;
  entryFeeSol: number;
  platformWallet: string;

  // Bot Wallet
  botWalletPrivateKey: string;

  // Polling Intervals
  sessionPollIntervalMs: number;    // How often to check for sessions
  gameStatePollIntervalMs: number;  // How often to check game state when active

  // Behavior
  actionDelayMinMs: number;         // Min delay before action (appear human)
  actionDelayMaxMs: number;         // Max delay before action

  // Betting Strategy (when card counting enabled)
  minBet: number;                   // Minimum bet (25 chips)
  maxBet: number;                   // Maximum bet (100 chips)
  countThresholdBetIncrease: number; // True count needed to increase bet

  // Logging
  logLevel: "debug" | "info" | "warn" | "error";
}

function getEnv(key: string, defaultValue?: string): string {
  const value = Deno.env.get(key);
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = Deno.env.get(key);
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = Deno.env.get(key);
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return parsed;
}

export const config: Config = {
  // Bot Control
  botEnabled: getEnvBool("BOT_ENABLED", true),
  cardCountingEnabled: getEnvBool("CARD_COUNTING_ENABLED", true),
  learningEnabled: getEnvBool("LEARNING_ENABLED", true),

  // Platform
  platformUrl: getEnv("PLATFORM_URL", "https://j1blackjack.com"),
  heliusRpcUrl: getEnv("HELIUS_RPC_URL", "https://api.devnet.solana.com"),
  entryFeeSol: getEnvNumber("ENTRY_FEE_SOL", 0.05),
  platformWallet: getEnv("PLATFORM_WALLET"),

  // Bot Wallet
  botWalletPrivateKey: getEnv("BOT_WALLET_PRIVATE_KEY"),

  // Polling
  sessionPollIntervalMs: getEnvNumber("SESSION_POLL_INTERVAL_MS", 60000),
  gameStatePollIntervalMs: getEnvNumber("GAME_STATE_POLL_INTERVAL_MS", 2000),

  // Behavior
  actionDelayMinMs: getEnvNumber("ACTION_DELAY_MIN_MS", 300),
  actionDelayMaxMs: getEnvNumber("ACTION_DELAY_MAX_MS", 800),

  // Betting (card counting)
  minBet: getEnvNumber("MIN_BET", 25),
  maxBet: getEnvNumber("MAX_BET", 100),
  countThresholdBetIncrease: getEnvNumber("COUNT_THRESHOLD_BET_INCREASE", 2),

  // Logging
  logLevel: (getEnv("LOG_LEVEL", "info") as Config["logLevel"]),
};
