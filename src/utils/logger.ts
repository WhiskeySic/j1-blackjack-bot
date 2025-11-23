/**
 * Simple logger utility
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.debug) {
      console.log(`[DEBUG]`, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.info) {
      console.log(`[INFO]`, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.warn) {
      console.warn(`[WARN]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.error) {
      console.error(`[ERROR]`, ...args);
    }
  }
}

// Get log level from environment
const logLevel = (Deno.env.get("LOG_LEVEL") || "info") as LogLevel;
export const logger = new Logger(logLevel);
