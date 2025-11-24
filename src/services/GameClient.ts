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
import { authenticatedFetch } from "../utils/walletAuth.ts";

interface PlayerState {
  participant_id: string;
  seat_position: number;
  wallet_address: string;
  display_name: string;
  chips: number;
  bet: number;
  cards: Card[];
  status: string;
}

interface GameState {
  session_id: string;
  table_id: string;
  hand_number: number;
  phase: string;
  dealer_hand: Card[];
  player_states: PlayerState[];
  current_turn_seat?: number;
  deck_state: Card[];
  betting_phase_started_at?: string;
}

export class GameClient {
  private platformUrl: string;
  private botWallet: BotWallet;
  private sessionId: string;
  private strategy: OptimalStrategy;
  private learning: LearningCoordinator;
  private isPlaying: boolean = false;
  private currentHandNumber: number = 0;
  private lastPhaseChangeTime: number = Date.now();
  private lastHandNumber: number = 0;
  private samePhaseCount: number = 0;
  private pollBackoff: number = 1;

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
            // Increase backoff if no state (might be slow backend)
            this.pollBackoff = Math.min(this.pollBackoff * 1.5, 5);
            await this.sleep(config.gameStatePollIntervalMs * this.pollBackoff);
            continue;
          }

          // Reset backoff on successful state fetch
          this.pollBackoff = 1;

          logger.debug(`[GameClient] Phase: ${gameState.phase}, Hand: ${gameState.hand_number}`);

          // Check for stuck session (timeout detection)
          if (this.isSessionStuck(gameState)) {
            logger.error("[GameClient] ⚠️ Session appears to be stuck - exiting");
            logger.error(`[GameClient] Phase: ${gameState.phase}, Hand: ${gameState.hand_number}`);
            logger.error(`[GameClient] Stuck for ${Math.floor((Date.now() - this.lastPhaseChangeTime) / 1000)}s`);
            break;
          }

          // Check if session is finished
          if (gameState.phase === "completed") {
            logger.info("[GameClient] Session completed");
            await this.handleSessionCompletion();
            break;
          }

          // Handle different phases
          if (gameState.phase === "betting") {
            logger.info("[GameClient] Detected betting phase");
            await this.handleBettingPhase(gameState);
          } else if (gameState.phase === "action") {
            const myTurn = this.isMyTurn(gameState);
            logger.debug(`[GameClient] Action phase, my turn: ${myTurn}`);
            if (myTurn) {
              await this.handleActionPhase(gameState);
            }
          }

          // Wait before next poll (with backoff if needed)
          await this.sleep(config.gameStatePollIntervalMs * this.pollBackoff);
        } catch (error) {
          logger.error("[GameClient] Error in game loop:", error);
          // Increase backoff on errors to avoid hammering failing API
          this.pollBackoff = Math.min(this.pollBackoff * 1.5, 5);
          await this.sleep(config.gameStatePollIntervalMs * this.pollBackoff);
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
    // Find Bob's player state
    const myState = gameState.player_states.find(
      p => p.wallet_address === this.botWallet.getPublicKey()
    );

    if (!myState) {
      logger.error("[GameClient] Player state not found in betting phase!");
      logger.error(`[GameClient] My wallet: ${this.botWallet.getPublicKey()}`);
      logger.error(`[GameClient] Players in game: ${gameState.player_states.map(p => p.wallet_address).join(', ')}`);
      return;
    }

    logger.info(`[GameClient] My state: bet=${myState.bet}, chips=${myState.chips}, status=${myState.status}`);

    // CRITICAL FIX: Check if it's Bob's turn to bet (prevent betting before turn)
    if (gameState.current_turn_seat !== undefined &&
        gameState.current_turn_seat !== myState.seat_position) {
      logger.debug(`[GameClient] Waiting for turn (current: seat ${gameState.current_turn_seat}, my seat: ${myState.seat_position})`);
      return;
    }

    // CRITICAL FIX: Check game_hands table for confirmed bet (source of truth)
    // This prevents race condition where state shows bet=0 but bet was already placed
    const confirmedBet = await this.checkBetHistory(gameState.session_id, gameState.hand_number);

    if (confirmedBet > 0) {
      logger.info(`[GameClient] Already placed bet (confirmed in game_hands: ${confirmedBet} chips)`);
      return;
    }

    // Check stale state as secondary guard
    if (myState.bet > 0) {
      logger.info(`[GameClient] Already placed bet (state shows: ${myState.bet} chips)`);
      return;
    }

    // Random delay to appear human
    await this.randomDelay(gameState);

    // Get bet size directly from card counter (uses true count from observed cards)
    // NOTE: Don't call getDecision() during betting - we don't have cards yet!
    const trueCount = this.strategy.cardCounter.getTrueCount();
    const betSize = this.strategy.cardCounter.getBet(myState.chips);

    logger.info(`[GameClient] Placing bet of ${betSize} chips (true count: ${trueCount.toFixed(1)})...`);

    const success = await this.placeBet(betSize);
    logger.info(`[GameClient] Bet placed: ${success ? 'SUCCESS' : 'FAILED'}`);
  }

  /**
   * Handle action phase (Bob's turn)
   */
  private async handleActionPhase(gameState: GameState): Promise<void> {
    // Find Bob's player state
    const myState = gameState.player_states.find(
      p => p.wallet_address === this.botWallet.getPublicKey()
    );

    if (!myState) {
      logger.warn("[GameClient] Player state not found");
      return;
    }

    // Observe dealer's upcard
    if (gameState.dealer_hand.length > 0) {
      this.strategy.observeCard(gameState.dealer_hand[0]);
    }

    // Observe Bob's cards
    for (const card of myState.cards) {
      this.strategy.observeCard(card);
    }

    // Calculate hand value
    const { value: playerTotal, isSoft } = this.calculateHandValue(myState.cards);

    // Check if can double or split
    const canDouble = myState.cards.length === 2 && myState.chips >= myState.bet;
    const canSplit = myState.cards.length === 2 &&
                     myState.cards[0].rank === myState.cards[1].rank &&
                     myState.chips >= myState.bet;

    // Build game situation
    const situation: GameSituation = {
      playerHand: myState.cards,
      playerTotal,
      isSoft,
      dealerUpcard: gameState.dealer_hand[0],
      trueCount: 0, // Will be set by card counter
      chipStack: myState.chips,
      currentRank: 1, // TODO: Get from game state
      handsRemaining: 10 - gameState.hand_number,
      canDouble,
      canSplit,
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
      const opponentWallets = gameState.player_states
        .filter(p => p.wallet_address !== this.botWallet.getPublicKey())
        .map(p => p.wallet_address);
      decision = this.learning.adjustDecisionForOpponent(decision, opponentWallets);
    }

    // Random delay to appear human
    await this.randomDelay(gameState);

    // Execute action
    logger.info(
      `[GameClient] Hand ${gameState.hand_number}: ` +
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
      const response = await authenticatedFetch(
        `${this.platformUrl}/session-game-state`,
        this.botWallet.getKeypair(),
        this.sessionId,
        "state",
        { sessionId: this.sessionId }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.state || data.gameState;
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
      const response = await authenticatedFetch(
        `${this.platformUrl}/session-results`,
        this.botWallet.getKeypair(),
        this.sessionId,
        "results",
        { sessionId: this.sessionId }
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
      const body = {
        action: "place_bet",
        sessionId: this.sessionId,
        walletAddress: this.botWallet.getPublicKey(),
        betAmount: amount,
      };
      logger.info(`[GameClient] Bet request: POST ${this.platformUrl}/game-action-turnbased`);
      logger.info(`[GameClient] Bet body: ${JSON.stringify(body)}`);

      const response = await authenticatedFetch(
        `${this.platformUrl}/game-action-turnbased`,
        this.botWallet.getKeypair(),
        this.sessionId,
        "place_bet",
        body
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[GameClient] Bet API error (${response.status}): ${errorText}`);
      }

      return response.ok;
    } catch (error) {
      logger.error("[GameClient] Failed to place bet:", error);
      return false;
    }
  }

  /**
   * Execute game action (hit, stand, double, split)
   */
  private async executeAction(action: string): Promise<boolean> {
    try {
      const body = {
        action,
        sessionId: this.sessionId,
        walletAddress: this.botWallet.getPublicKey(),
      };
      logger.info(`[GameClient] Action request: POST ${this.platformUrl}/game-action-turnbased`);
      logger.info(`[GameClient] Action body: ${JSON.stringify(body)}`);

      const response = await authenticatedFetch(
        `${this.platformUrl}/game-action-turnbased`,
        this.botWallet.getKeypair(),
        this.sessionId,
        action,
        body
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[GameClient] Action API error (${response.status}): ${errorText}`);
      }

      return response.ok;
    } catch (error) {
      logger.error(`[GameClient] Failed to execute ${action}:`, error);
      return false;
    }
  }

  /**
   * Check bet history in game_hands table (source of truth)
   * Returns confirmed bet amount, or 0 if no bet found
   */
  private async checkBetHistory(sessionId: string, handNumber: number): Promise<number> {
    try {
      // Try to fetch hand history from backend
      const response = await authenticatedFetch(
        `${this.platformUrl}/session-game-state`,
        this.botWallet.getKeypair(),
        sessionId,
        "check_bet_history",
        {
          sessionId,
          handNumber,
          walletAddress: this.botWallet.getPublicKey(),
          action: "get_bet_history"
        }
      );

      if (response.ok) {
        const data = await response.json();
        // Check if response has bet data
        if (data.betAmount !== undefined) {
          return data.betAmount;
        }
        // Alternative: check if game_hands data is in response
        if (data.gameHands && Array.isArray(data.gameHands)) {
          const myHand = data.gameHands.find(
            (h: any) => h.wallet_address === this.botWallet.getPublicKey() &&
                       h.hand_number === handNumber
          );
          if (myHand?.bet_amount) {
            return myHand.bet_amount;
          }
        }
      }
    } catch (error) {
      logger.debug("[GameClient] Could not check bet history (API may not support it):", error);
    }

    // Fallback: assume no confirmed bet (rely on state check)
    return 0;
  }

  /**
   * Check if session is stuck (no progress for too long)
   */
  private isSessionStuck(gameState: GameState): boolean {
    const now = Date.now();
    const phaseKey = `${gameState.phase}-${gameState.hand_number}`;
    const lastPhaseKey = `${this.lastHandNumber}`;

    // Track if phase/hand has changed
    if (gameState.hand_number !== this.lastHandNumber) {
      // Hand number changed - reset timeout
      this.lastPhaseChangeTime = now;
      this.lastHandNumber = gameState.hand_number;
      this.samePhaseCount = 0;
      return false;
    }

    // Same phase/hand - check if stuck
    const stuckDuration = now - this.lastPhaseChangeTime;

    // Timeout thresholds
    const BETTING_TIMEOUT = 5 * 60 * 1000; // 5 minutes in betting phase
    const ACTION_TIMEOUT = 3 * 60 * 1000;  // 3 minutes in action phase

    if (gameState.phase === "betting" && stuckDuration > BETTING_TIMEOUT) {
      this.samePhaseCount++;
      if (this.samePhaseCount > 30) { // 30 polls = 60 seconds of continuous stuck state
        return true;
      }
    }

    if (gameState.phase === "action" && stuckDuration > ACTION_TIMEOUT) {
      this.samePhaseCount++;
      if (this.samePhaseCount > 20) { // 20 polls = 40 seconds of continuous stuck state
        return true;
      }
    }

    return false;
  }

  /**
   * Check if it's Bob's turn
   */
  private isMyTurn(gameState: GameState): boolean {
    const myState = gameState.player_states.find(
      p => p.wallet_address === this.botWallet.getPublicKey()
    );

    if (!myState) return false;

    // Check if it's my seat's turn
    const isMyTurn = gameState.current_turn_seat === myState.seat_position;

    // Check if my status allows action (use blacklist instead of whitelist)
    const cannotAct = ['busted', 'stood', 'blackjack', 'completed', 'finished'].includes(myState.status);
    const canAct = !cannotAct;

    logger.debug(`[GameClient] Turn check: isMyTurn=${isMyTurn}, status=${myState.status}, canAct=${canAct}`);

    return isMyTurn && canAct;
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
   * Skips delay if Bob is the only active player (no point in appearing human to yourself!)
   */
  private async randomDelay(gameState?: GameState): Promise<void> {
    // Skip delay if only 1 player in session (no need to appear human)
    if (gameState) {
      const activePlayers = gameState.player_states.filter(
        p => p.status !== 'busted' && p.status !== 'completed'
      ).length;

      if (activePlayers <= 1) {
        logger.debug("[GameClient] Skipping delay (only player remaining)");
        return;
      }
    }

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
