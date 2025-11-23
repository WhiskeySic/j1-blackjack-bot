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
  max_players: number;
  entry_fee: number;
  started_at: string;
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
    try {
      const sessions = await this.fetchLobbySessions();

      logger.debug(`[SessionMonitor] Checking ${sessions.length} sessions...`);

      for (const session of sessions) {
        // Skip if not in waiting phase (accepting registrations)
        if (session.status !== "waiting") {
          continue;
        }

        // Skip if already registered for this session
        if (this.registeredSessions.has(session.id)) {
          continue;
        }

        // Skip if already in an active session
        if (this.activeGameClient !== null) {
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
      // Lobby-sessions doesn't require authentication, just POST with empty body
      const response = await fetch(`${this.platformUrl}/lobby-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
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
      const hasFunds = await this.botWallet.hasSufficientBalance(session.entry_fee);
      if (!hasFunds) {
        logger.error(
          `[SessionMonitor] Insufficient balance for session ${session.id} ` +
          `(need ${session.entry_fee} SOL)`
        );
        return;
      }

      logger.info(`[SessionMonitor] Registering Bob for session ${session.id}...`);

      // Pay entry fee
      const txSignature = await this.botWallet.payEntryFee(
        config.platformWallet,
        session.entry_fee
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
          walletAddress: this.botWallet.getPublicKey(),
          displayName: "Bob 🤖",
          txSignature,
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
