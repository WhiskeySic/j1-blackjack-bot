/**
 * Session Monitor - Monitors lobby for sessions needing Bob
 *
 * Polls the lobby API and registers Bob when a session has only 1 player.
 */

import { BotWallet } from "./BotWallet.ts";
import { GameClient } from "./GameClient.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";
import { authenticatedFetch } from "../utils/walletAuth.ts";

interface LobbySession {
  id: string;
  session_number: number;
  status: string;
  current_players: number;
  prize_pool?: number;
  join_window_ends_at?: string;
  hands_played?: number;
  hands_total?: number;
}

export class SessionMonitor {
  private platformUrl: string;
  private botWallet: BotWallet;
  private pollInterval: number;
  private isRunning: boolean = false;
  private activeGameClient: GameClient | null = null;
  private registeredSessions: Set<string> = new Set();

  constructor(
    platformUrl: string,
    botWallet: BotWallet,
    pollInterval: number
  ) {
    this.platformUrl = platformUrl;
    this.botWallet = botWallet;
    this.pollInterval = pollInterval;
  }

  /**
   * Start monitoring sessions
   */
  async start(): Promise<void> {
    if (!config.botEnabled) {
      logger.warn("[SessionMonitor] Bot is disabled - not starting monitor");
      return;
    }

    this.isRunning = true;
    logger.info("[SessionMonitor] Starting session monitor...");

    while (this.isRunning) {
      try {
        await this.checkSessions();
      } catch (error) {
        logger.error("[SessionMonitor] Error checking sessions:", error);
      }

      // Wait before next poll
      await this.sleep(this.pollInterval);
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.isRunning = false;
    logger.info("[SessionMonitor] Stopped session monitor");
  }

  /**
   * Check lobby for sessions needing Bob
   */
  private async checkSessions(): Promise<void> {
    logger.info("[SessionMonitor] 🔄 Checking sessions...");
    try {
      const sessions = await this.fetchLobbySessions();

      logger.info(`[SessionMonitor] Polling... found ${sessions.length} sessions`);

      for (const session of sessions) {
        logger.info(
          `[SessionMonitor] Session ${session.session_number}: ` +
          `status="${session.status}", players=${session.current_players}`
        );

        // Skip if already in an active session
        if (this.activeGameClient !== null) {
          logger.info(`[SessionMonitor] Already in active session, skipping ${session.session_number}`);
          continue;
        }

        // CRITICAL FIX: Check if Bob is already in this session (from previous bot crash/restart)
        if (session.status === "in_progress") {
          logger.info(`[SessionMonitor] 🔍 Checking if Bob is in session ${session.session_number}...`);
          const isBobInSession = await this.checkIfBobInSession(session.id);
          logger.info(`[SessionMonitor] Bob in session ${session.session_number}? ${isBobInSession}`);

          if (isBobInSession) {
            logger.info(`[SessionMonitor] 🔄 REJOINING active session ${session.session_number} - Bob is already playing!`);

            // Start game client WITHOUT paying entry fee again
            this.activeGameClient = new GameClient(
              this.platformUrl,
              this.botWallet,
              session.id
            );

            await this.activeGameClient.play();

            // Session completed - reset
            this.activeGameClient = null;
            logger.info(`[SessionMonitor] Session ${session.id} completed`);
            continue;
          }
        }

        // Skip if not in waiting phase (accepting new registrations)
        if (session.status !== "waiting") {
          continue;
        }

        // Skip if already registered for this session
        if (this.registeredSessions.has(session.id)) {
          logger.info(`[SessionMonitor] Already registered for session ${session.session_number}`);
          continue;
        }

        // Check if session has exactly 1 player (needs Bob)
        if (session.current_players === 1) {
          logger.info(
            `[SessionMonitor] Found single-player session: ${session.id} ` +
            `(session #${session.session_number})`
          );

          await this.registerForSession(session);
        }
      }
    } catch (error) {
      logger.error("[SessionMonitor] Failed to check sessions:", error);
    }
  }

  /**
   * Fetch active lobby sessions
   */
  private async fetchLobbySessions(): Promise<LobbySession[]> {
    try {
      logger.info(`[SessionMonitor] Fetching from ${this.platformUrl}/lobby-sessions...`);
      // Lobby-sessions doesn't require authentication, just POST with empty body
      const response = await fetch(`${this.platformUrl}/lobby-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      logger.info(`[SessionMonitor] Response status: ${response.status}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info(`[SessionMonitor] Got ${data.sessions?.length || 0} sessions from API`);
      return data.sessions || [];
    } catch (error) {
      logger.error("[SessionMonitor] Failed to fetch lobby sessions:", error);
      return [];
    }
  }

  /**
   * Register Bob for a session
   */
  private async registerForSession(session: LobbySession): Promise<void> {
    try {
      // Check wallet balance
      const hasFunds = await this.botWallet.hasSufficientBalance(config.entryFeeSol);
      if (!hasFunds) {
        logger.error(
          `[SessionMonitor] Insufficient balance for session ${session.id} ` +
          `(need ${config.entryFeeSol} SOL)`
        );
        return;
      }

      logger.info(`[SessionMonitor] Registering Bob for session ${session.id}...`);

      // Pay entry fee
      const txSignature = await this.botWallet.payEntryFee(
        config.platformWallet,
        config.entryFeeSol
      );

      logger.info(`[SessionMonitor] Entry fee paid: ${txSignature}`);

      // Register via API
      const registered = await this.callRegisterAPI(session.id, txSignature);

      if (registered) {
        logger.info(`[SessionMonitor] ✅ Bob registered for session ${session.id}`);
        this.registeredSessions.add(session.id);

        // Start game client to play this session
        this.activeGameClient = new GameClient(
          this.platformUrl,
          this.botWallet,
          session.id
        );

        await this.activeGameClient.play();

        // Session completed - reset
        this.activeGameClient = null;
        logger.info(`[SessionMonitor] Session ${session.id} completed`);
      } else {
        logger.error(`[SessionMonitor] Failed to register Bob via API`);
      }
    } catch (error) {
      logger.error(`[SessionMonitor] Error registering for session ${session.id}:`, error);
    }
  }

  /**
   * Check if Bob is already registered in a session
   */
  private async checkIfBobInSession(sessionId: string): Promise<boolean> {
    try {
      // Fetch game state to see if Bob is a participant
      const response = await authenticatedFetch(
        `${this.platformUrl}/session-game-state`,
        this.botWallet.getKeypair(),
        sessionId,
        "check_participation",
        { sessionId }
      );

      logger.info(`[SessionMonitor] API response status: ${response.status}`);

      if (!response.ok) {
        logger.info(`[SessionMonitor] API returned not OK, Bob not in session`);
        return false;
      }

      const data = await response.json();
      const gameState = data.state || data.gameState;

      logger.info(`[SessionMonitor] gameState exists: ${!!gameState}`);
      logger.info(`[SessionMonitor] player_states exists: ${!!gameState?.player_states}`);
      logger.info(`[SessionMonitor] player_states length: ${gameState?.player_states?.length || 0}`);

      if (!gameState || !gameState.player_states) {
        logger.info(`[SessionMonitor] No game state or player_states, Bob not in session`);
        return false;
      }

      // Check if Bob's wallet is in the player_states
      const bobWallet = this.botWallet.getPublicKey();
      logger.info(`[SessionMonitor] Bob's wallet: ${bobWallet}`);
      logger.info(`[SessionMonitor] Players in session: ${gameState.player_states.map((p: any) => p.wallet_address).join(', ')}`);

      const isBobPlaying = gameState.player_states.some(
        (p: any) => p.wallet_address === bobWallet
      );

      logger.info(`[SessionMonitor] Bob found in player_states: ${isBobPlaying}`);
      return isBobPlaying;
    } catch (error) {
      logger.error(`[SessionMonitor] Error checking Bob's participation in ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Call platform's register-participant API
   */
  private async callRegisterAPI(
    sessionId: string,
    txSignature: string
  ): Promise<boolean> {
    try {
      // Use authenticated request for registration
      const response = await authenticatedFetch(
        `${this.platformUrl}/register-participant`,
        this.botWallet.getKeypair(),
        sessionId,
        "register",
        {
          sessionId,
          displayName: "Bob",
          paymentSignature: txSignature,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.error(`[SessionMonitor] Registration API error: ${error}`);
        return false;
      }

      const data = await response.json();
      return data.success === true || data.ok === true;
    } catch (error) {
      logger.error("[SessionMonitor] Failed to call register API:", error);
      return false;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
