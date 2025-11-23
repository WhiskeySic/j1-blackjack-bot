/**
 * Card Counter - Hi-Lo Counting System
 *
 * Tracks deck composition and provides betting/strategy adjustments.
 * Can be toggled on/off via configuration.
 */

import { Card } from "../types.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export class CardCounter {
  private runningCount: number = 0;
  private cardsDealt: number = 0;
  private readonly totalCards: number = 416; // 8 decks
  private enabled: boolean;

  constructor(enabled: boolean = config.cardCountingEnabled) {
    this.enabled = enabled;

    if (this.enabled) {
      logger.info("🎯 Card counting ENABLED - Bob will have advantage");
    } else {
      logger.info("🎲 Card counting DISABLED - Bob uses basic optimal strategy");
    }
  }

  /**
   * Update count when a card is seen
   */
  updateCount(card: Card): void {
    if (!this.enabled) return;

    this.cardsDealt++;

    // Hi-Lo counting system
    const rank = card.rank;

    if (['2', '3', '4', '5', '6'].includes(rank)) {
      this.runningCount++; // Low cards out = favorable for player
    } else if (['10', 'J', 'Q', 'K', 'A'].includes(rank)) {
      this.runningCount--; // High cards out = favorable for dealer
    }
    // 7, 8, 9 are neutral (no change)
  }

  /**
   * Get true count (running count divided by decks remaining)
   */
  getTrueCount(): number {
    if (!this.enabled) return 0;

    const cardsRemaining = this.totalCards - this.cardsDealt;
    const decksRemaining = cardsRemaining / 52;

    if (decksRemaining <= 0) return 0;

    const trueCount = this.runningCount / decksRemaining;
    return Math.round(trueCount * 10) / 10; // Round to 1 decimal
  }

  /**
   * Get recommended bet size based on true count
   */
  getBet(currentChips: number): number {
    if (!this.enabled) {
      return config.minBet; // Always min bet if counting disabled
    }

    const trueCount = this.getTrueCount();
    const minBet = config.minBet;
    const maxBet = Math.min(config.maxBet, currentChips);

    // Betting spread based on true count
    if (trueCount >= 5) {
      // Very favorable - max bet
      return maxBet;
    } else if (trueCount >= 4) {
      // Highly favorable - 80% of max
      return Math.min(Math.floor(maxBet * 0.8), currentChips);
    } else if (trueCount >= 3) {
      // Favorable - 60% of max
      return Math.min(Math.floor(maxBet * 0.6), currentChips);
    } else if (trueCount >= config.countThresholdBetIncrease) {
      // Slightly favorable - 40% of max
      return Math.min(Math.floor(maxBet * 0.4), currentChips);
    } else if (trueCount <= -2) {
      // Very unfavorable - absolute minimum
      return minBet;
    }

    // Neutral or slightly unfavorable - min bet
    return minBet;
  }

  /**
   * Get insurance recommendation (true count >= 3 = take insurance)
   */
  shouldTakeInsurance(): boolean {
    if (!this.enabled) return false;

    const trueCount = this.getTrueCount();
    return trueCount >= 3; // Only take insurance when deck is rich in 10s
  }

  /**
   * Adjust strategy based on count
   * Returns modifier for EV calculations
   */
  getStrategyModifier(): number {
    if (!this.enabled) return 0;

    const trueCount = this.getTrueCount();

    // Positive count = more aggressive (hit less, stand more, double more)
    // Returns value from -0.1 to +0.1
    return Math.max(-0.1, Math.min(0.1, trueCount * 0.02));
  }

  /**
   * Get current count statistics
   */
  getStats() {
    return {
      enabled: this.enabled,
      runningCount: this.runningCount,
      trueCount: this.getTrueCount(),
      cardsDealt: this.cardsDealt,
      cardsRemaining: this.totalCards - this.cardsDealt,
      penetration: ((this.cardsDealt / this.totalCards) * 100).toFixed(1) + '%',
    };
  }

  /**
   * Log current count status
   */
  logStatus(): void {
    if (!this.enabled) return;

    const stats = this.getStats();
    logger.debug(
      `[CardCounter] RC: ${stats.runningCount}, TC: ${stats.trueCount}, ` +
      `Dealt: ${stats.cardsDealt}/${this.totalCards} (${stats.penetration})`
    );
  }

  /**
   * Reset count (for new session)
   */
  reset(): void {
    this.runningCount = 0;
    this.cardsDealt = 0;

    if (this.enabled) {
      logger.info("[CardCounter] Count reset for new session");
    }
  }

  /**
   * Enable or disable card counting mid-session
   */
  setEnabled(enabled: boolean): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;

    if (wasEnabled !== enabled) {
      logger.info(
        `[CardCounter] Card counting ${enabled ? 'ENABLED' : 'DISABLED'}`
      );
    }
  }

  /**
   * Check if card counting is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
