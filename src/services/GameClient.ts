/**
 * Game Client - Handles gameplay for an active session
 *
 * Polls game state, makes decisions, executes actions, tracks learning data.
 */

import { BotWallet } from "./BotWallet.ts";
import { OptimalStrategy } from "../strategy/OptimalStrategy.ts";
import { CardCounter } from "../strategy/CardCounter.ts";
import { LearningCoordinator } from "../learning/LearningCoordinator.ts";
import { Card, GameSituation, GameExperience, SessionResult, OpponentSessionData } from "../types.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";

interface GameState {
  session_id: string;
  phase: string;
  current_hand: number;
  wallet_address: string;
  current_hand_cards: Card[];
  current_bet: number;
  current_chips: number;
  dealer_hand: Card[];
  can_double: boolean;
  can_split: boolean;
  is_busted: boolean;
  is_active: boolean;
}

export class GameClient {
  private platformUrl: string;
  private botWallet: BotWallet;
  private sessionId: string;
  private strategy: OptimalStrategy;
  private learning: LearningCoordinator;
  private isPlaying: boolean = false;
  private currentHandNumber: number = 0;

  constructor(
    platformUrl: string,
    botWallet: BotWallet,
    sessionId: string
  ) {
    this.platformUrl = platformUrl;
    this.botWallet = botWallet;
    this.sessionId = sessionId;

    // Initialize strategy and learning
    const cardCounter = new CardCounter(config.cardCountingEnabled);
    this.strategy = new OptimalStrategy(cardCounter);
    this.learning = new LearningCoordinator();
  }

  /**
   * Play the session from start to finish
   */
  async play(): Promise<void> {
    try {
      logger.info(`[GameClient] Starting session ${this.sessionId}`);

      // Initialize learning system
      if (config.learningEnabled) {
        await this.learning.init();
        this.learning.startSession(this.sessionId);
      }

      this.isPlaying = true;

      // Wait for session to start
      await this.waitForSessionStart();

      // Main game loop
      while (this.isPlaying) {
        try {
          const gameState = await this.fetchGameState();

          if (!gameState) {
            logger.warn("[GameClient] No game state found");
            await this.sleep(config.gameStatePollIntervalMs);
            continue;
          }

          // Check if session is finished
          if (gameState.phase === "completed") {
            logger.info("[GameClient] Session completed");
            await this.handleSessionCompletion();
            break;
          }

          // Handle different phases
          if (gameState.phase === "betting") {
            await this.handleBettingPhase(gameState);
          } else if (gameState.phase === "action" && this.isMyTurn(gameState)) {
            await this.handleActionPhase(gameState);
          }

          // Wait before next poll
          await this.sleep(config.gameStatePollIntervalMs);
        } catch (error) {
          logger.error("[GameClient] Error in game loop:", error);
          await this.sleep(config.gameStatePollIntervalMs);
        }
      }

      logger.info(`[GameClient] Finished session ${this.sessionId}`);
    } catch (error) {
      logger.error(`[GameClient] Fatal error in session ${this.sessionId}:`, error);
      this.isPlaying = false;
    }
  }

  /**
   * Wait for session to transition from registration to active
   */
  private async waitForSessionStart(): Promise<void> {
    logger.info("[GameClient] Waiting for session to start...");

    while (true) {
      const gameState = await this.fetchGameState();

      if (gameState && gameState.phase !== "registration") {
        logger.info("[GameClient] Session started");
        break;
      }

      await this.sleep(5000); // Check every 5 seconds
    }
  }

  /**
   * Handle betting phase
   */
  private async handleBettingPhase(gameState: GameState): Promise<void> {
    // Check if we've already bet
    if (gameState.current_bet > 0) {
      return; // Already bet
    }

    // Random delay to appear human
    await this.randomDelay();

    // Get bet size from strategy (card counter)
    const betSize = this.strategy.getDecision({
      playerHand: [],
      playerTotal: 0,
      isSoft: false,
      dealerUpcard: { suit: 'hearts', rank: '10' }, // Placeholder
      trueCount: 0,
      chipStack: gameState.current_chips,
      currentRank: 1,
      handsRemaining: 10 - gameState.current_hand,
      canDouble: false,
      canSplit: false,
    }, 0).betSize || config.minBet;

    logger.info(`[GameClient] Betting ${betSize} chips`);

    await this.placeBet(betSize);
  }

  /**
   * Handle action phase (Bob's turn)
   */
  private async handleActionPhase(gameState: GameState): Promise<void> {
    // Observe dealer's upcard
    if (gameState.dealer_hand.length > 0) {
      this.strategy.observeCard(gameState.dealer_hand[0]);
    }

    // Observe Bob's cards
    for (const card of gameState.current_hand_cards) {
      this.strategy.observeCard(card);
    }

    // Calculate hand value
    const { value: playerTotal, isSoft } = this.calculateHandValue(gameState.current_hand_cards);

    // Build game situation
    const situation: GameSituation = {
      playerHand: gameState.current_hand_cards,
      playerTotal,
      isSoft,
      dealerUpcard: gameState.dealer_hand[0],
      trueCount: 0, // Will be set by card counter
      chipStack: gameState.current_chips,
      currentRank: 1, // TODO: Get from game state
      handsRemaining: 10 - gameState.current_hand,
      canDouble: gameState.can_double,
      canSplit: gameState.can_split,
    };

    // Get learning adjustment if enabled
    let learningAdjustment = 0;
    if (config.learningEnabled) {
      learningAdjustment = this.learning.getStrategyAdjustment(
        playerTotal,
        gameState.dealer_hand[0].rank,
        'hit' // Default action for adjustment calc
      );
    }

    // Get optimal decision
    let decision = this.strategy.getDecision(situation, learningAdjustment);

    // Adjust based on opponent profiles if learning enabled
    if (config.learningEnabled) {
      decision = this.learning.adjustDecisionForOpponent(decision, []); // TODO: Get opponent wallets
    }

    // Random delay to appear human
    await this.randomDelay();

    // Execute action
    logger.info(
      `[GameClient] Hand ${gameState.current_hand}: ` +
      `${playerTotal}${isSoft ? ' (soft)' : ''} vs dealer ${gameState.dealer_hand[0].rank} -> ` +
      `${decision.action} (EV: ${decision.expectedValue.toFixed(3)})`
    );

    await this.executeAction(decision.action);

    // Track experience if learning enabled
    if (config.learningEnabled) {
      this.currentHandNumber++;
      // Experience will be recorded after hand completion
    }
  }

  /**
   * Handle session completion
   */
  private async handleSessionCompletion(): Promise<void> {
    try {
      // Fetch session results
      const results = await this.fetchSessionResults();

      if (!results) {
        logger.warn("[GameClient] Could not fetch session results");
        return;
      }

      logger.info(
        `[GameClient] Final Result: Rank ${results.finalRank}/${results.totalPlayers}, ` +
        `${results.finalChips} chips, Payout: ${results.payout} SOL`
      );

      // Record session in learning system
      if (config.learningEnabled) {
        await this.learning.recordSession(results, results.finalRank);
        await this.learning.save();

        // Log learning stats
        const stats = this.learning.getStats();
        logger.info(
          `[Learning] Total sessions: ${stats.totalSessions}, ` +
          `Win rate: ${(stats.overallWinRate * 100).toFixed(1)}%`
        );
      }
    } catch (error) {
      logger.error("[GameClient] Error handling session completion:", error);
    }
  }

  /**
   * Fetch current game state
   */
  private async fetchGameState(): Promise<GameState | null> {
    try {
      const response = await fetch(
        `${this.platformUrl}/api/game-state/${this.sessionId}?wallet=${this.botWallet.getPublicKey()}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.gameState;
    } catch (error) {
      logger.error("[GameClient] Failed to fetch game state:", error);
      return null;
    }
  }

  /**
   * Fetch session results
   */
  private async fetchSessionResults(): Promise<SessionResult | null> {
    try {
      const response = await fetch(
        `${this.platformUrl}/api/session-results/${this.sessionId}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      // Find Bob's result
      const bobResult = data.participants.find(
        (p: any) => p.wallet_address === this.botWallet.getPublicKey()
      );

      if (!bobResult) {
        return null;
      }

      // Build opponent data
      const opponents: OpponentSessionData[] = data.participants
        .filter((p: any) => p.wallet_address !== this.botWallet.getPublicKey())
        .map((p: any) => ({
          walletAddress: p.wallet_address,
          finalRank: p.final_rank,
          finalChips: p.current_chips,
          handsWon: p.hands_won || 0,
          avgBetSize: 25, // TODO: Track from game logs
          totalHits: 0,
          totalStands: 0,
          totalDoubles: 0,
          totalSplits: 0,
        }));

      return {
        sessionId: this.sessionId,
        finalRank: bobResult.final_rank,
        totalPlayers: data.participants.length,
        finalChips: bobResult.current_chips,
        handsPlayed: 10, // TODO: Get from game state
        handsWon: bobResult.hands_won || 0,
        totalWagered: bobResult.current_bet * 10, // Estimate
        netProfit: bobResult.current_chips - 1000,
        payout: bobResult.payout || 0,
        opponents,
        completedAt: Date.now(),
      };
    } catch (error) {
      logger.error("[GameClient] Failed to fetch session results:", error);
      return null;
    }
  }

  /**
   * Place bet
   */
  private async placeBet(amount: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.platformUrl}/api/game-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          walletAddress: this.botWallet.getPublicKey(),
          action: "bet",
          betAmount: amount,
        }),
      });

      return response.ok;
    } catch (error) {
      logger.error("[GameClient] Failed to place bet:", error);
      return false;
    }
  }

  /**
   * Execute game action
   */
  private async executeAction(action: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.platformUrl}/api/game-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          walletAddress: this.botWallet.getPublicKey(),
          action,
        }),
      });

      return response.ok;
    } catch (error) {
      logger.error(`[GameClient] Failed to execute ${action}:`, error);
      return false;
    }
  }

  /**
   * Check if it's Bob's turn
   */
  private isMyTurn(gameState: GameState): boolean {
    return gameState.wallet_address === this.botWallet.getPublicKey() &&
           gameState.is_active &&
           !gameState.is_busted;
  }

  /**
   * Calculate hand value
   */
  private calculateHandValue(cards: Card[]): { value: number; isSoft: boolean } {
    let total = 0;
    let aces = 0;

    for (const card of cards) {
      if (card.rank === 'A') {
        aces += 1;
      } else if (['K', 'Q', 'J'].includes(card.rank)) {
        total += 10;
      } else {
        total += parseInt(card.rank);
      }
    }

    let isSoft = false;
    for (let i = 0; i < aces; i++) {
      if (total + 11 + (aces - i - 1) <= 21) {
        total += 11;
        isSoft = true;
      } else {
        total += 1;
      }
    }

    return { value: total, isSoft };
  }

  /**
   * Random delay to appear human
   */
  private async randomDelay(): Promise<void> {
    const delay = Math.floor(
      Math.random() * (config.actionDelayMaxMs - config.actionDelayMinMs) +
      config.actionDelayMinMs
    );
    await this.sleep(delay);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
