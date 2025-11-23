/**
 * Learning Coordinator - Master controller for Bob's learning system
 *
 * Coordinates opponent profiling, experience tracking, and memory management.
 */

import { OpponentProfiler } from "./OpponentProfiler.ts";
import { ExperienceTracker } from "./ExperienceTracker.ts";
import { MemoryManager } from "./MemoryManager.ts";
import {
  GameExperience,
  SessionResult,
  OpponentSessionData,
  LearningInsights,
  BobDecision,
} from "../types.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export class LearningCoordinator {
  private profiler: OpponentProfiler;
  private tracker: ExperienceTracker;
  private memory: MemoryManager;
  private enabled: boolean;
  private currentSessionId: string | null = null;
  private currentSessionHandCount: number = 0;

  constructor(memoryFilePath?: string) {
    this.memory = new MemoryManager(memoryFilePath);
    this.enabled = config.botEnabled;

    // Placeholder - will be initialized in init()
    this.profiler = new OpponentProfiler();
    this.tracker = new ExperienceTracker();
  }

  /**
   * Initialize learning system (load from disk)
   */
  async init(): Promise<void> {
    if (!this.enabled) {
      logger.info("[Learning] Learning system DISABLED");
      return;
    }

    // Load Bob's memory
    const bobMemory = await this.memory.load();

    // Initialize components with loaded data
    this.profiler = new OpponentProfiler(bobMemory.opponentProfiles);
    this.tracker = new ExperienceTracker(
      bobMemory.recentExperiences,
      bobMemory.recentSessions
    );

    logger.info("[Learning] Learning system initialized");

    // Log learning effectiveness
    const effectiveness = this.memory.getLearningEffectiveness();
    if (effectiveness.sessionsPlayed > 20) {
      logger.info(
        `[Learning] Effectiveness: ${effectiveness.improving ? '✅ Improving' : '⚠️  Stable'} ` +
        `(${(effectiveness.improvementRate * 100).toFixed(1)}% improvement)`
      );
    }
  }

  /**
   * Start tracking a new session
   */
  startSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.currentSessionHandCount = 0;
    logger.debug(`[Learning] Started tracking session ${sessionId}`);
  }

  /**
   * Record a hand experience
   */
  recordHand(experience: GameExperience): void {
    if (!this.enabled || !this.currentSessionId) return;

    this.tracker.recordHand(experience);
    this.currentSessionHandCount++;
  }

  /**
   * Record session completion and update all systems
   */
  async recordSession(
    sessionResult: SessionResult,
    bobRank: number
  ): Promise<void> {
    if (!this.enabled) return;

    // Record in tracker
    this.tracker.recordSession(sessionResult);

    // Update opponent profiles
    for (const opponent of sessionResult.opponents) {
      this.profiler.updateProfile(opponent.walletAddress, opponent, bobRank);
    }

    // Update memory
    this.memory.updatePerformance(sessionResult);
    this.memory.updateOpponentProfiles(this.profiler.getAllProfiles());
    this.memory.updateExperiences(
      this.tracker.getExperiences(),
      this.tracker.getSessions()
    );

    // Generate insights
    const insights = this.generateInsights(sessionResult.sessionId);
    this.logInsights(insights);

    // Save to disk
    await this.save();

    // Reset session tracking
    this.currentSessionId = null;
    this.currentSessionHandCount = 0;

    logger.info(
      `[Learning] Session ${sessionResult.sessionId} recorded: ` +
      `Rank ${sessionResult.finalRank}/${sessionResult.totalPlayers}`
    );
  }

  /**
   * Generate insights from learning data
   */
  generateInsights(sessionId: string): LearningInsights {
    const sessionInsights = this.tracker.generateSessionInsights(sessionId);

    // Get opponent insights
    const session = this.tracker.getSessions().find(s => s.sessionId === sessionId);
    const opponentInsights = session?.opponents.map(o => ({
      walletAddress: o.walletAddress,
      insight: this.profiler.getOpponentInsights(o.walletAddress).join("; "),
    })) || [];

    // Determine performance trend
    const performanceTrend = this.tracker.getPerformanceTrend();

    // Generate strategy suggestions
    const suggestedAdjustments: string[] = [];
    const stats = this.tracker.getSummaryStats();

    if (stats.avgRank > 2.5) {
      suggestedAdjustments.push("Consider more aggressive betting when count is favorable");
    }

    if (stats.avgChips < 1000) {
      suggestedAdjustments.push("Focus on chip preservation in early hands");
    }

    const actionStats = this.tracker.analyzeActionEffectiveness();
    const doubleStats = actionStats.find(a => a.action === 'double');
    if (doubleStats && doubleStats.winRate < 0.4) {
      suggestedAdjustments.push("Review double-down situations - lower win rate than expected");
    }

    return {
      sessionInsights,
      opponentInsights,
      performanceTrend,
      suggestedAdjustments,
    };
  }

  /**
   * Get strategy adjustment based on learned data
   */
  getStrategyAdjustment(
    playerTotal: number,
    dealerUpcardRank: string,
    action: string
  ): number {
    if (!this.enabled) return 0;

    // Get learned EV adjustment from experience
    return this.tracker.getLearnedEVAdjustment(playerTotal, dealerUpcardRank, action);
  }

  /**
   * Adjust decision based on opponent profile
   */
  adjustDecisionForOpponent(
    decision: BotDecision,
    opponentWallets: string[]
  ): BotDecision {
    if (!this.enabled || opponentWallets.length === 0) {
      return decision;
    }

    // Get profiles of current opponents
    const opponents = opponentWallets
      .map(w => this.profiler.getProfile(w))
      .filter(p => p !== undefined);

    if (opponents.length === 0) {
      return decision; // No data on these opponents
    }

    // Calculate average opponent skill
    const avgSkill = opponents.reduce((sum, o) => sum + o.stats.skillScore, 0) / opponents.length;
    const avgAggression = opponents.reduce((sum, o) => sum + o.stats.aggressionScore, 0) / opponents.length;

    // Adjust bet size based on opponents
    if (decision.betSize && avgSkill < 0.4) {
      // Weak opponents - can bet more aggressively
      decision.betSize = Math.min(decision.betSize! * 1.2, 100);
      logger.debug("[Learning] Increasing bet vs weak opponents");
    } else if (avgAggression > 0.7) {
      // Aggressive opponents - play more conservatively
      decision.betSize = decision.betSize || 25;
      logger.debug("[Learning] Conservative play vs aggressive opponents");
    }

    return decision;
  }

  /**
   * Get summary statistics
   */
  getStats() {
    const trackerStats = this.tracker.getSummaryStats();
    const memoryEffectiveness = this.memory.getLearningEffectiveness();
    const opponentCount = this.profiler.getAllProfiles().size;

    return {
      enabled: this.enabled,
      ...trackerStats,
      opponentProfiles: opponentCount,
      learningEffectiveness: memoryEffectiveness,
    };
  }

  /**
   * Export learning data
   */
  async export(): Promise<void> {
    await this.memory.exportToCSV();
    logger.info("[Learning] Exported learning data to CSV");
  }

  /**
   * Save memory to disk
   */
  async save(): Promise<void> {
    await this.memory.save();
  }

  /**
   * Log insights to console
   */
  private logInsights(insights: LearningInsights): void {
    logger.info("=== Session Insights ===");
    logger.info(`Best: ${insights.sessionInsights.bestDecision}`);
    logger.info(`Worst: ${insights.sessionInsights.worstDecision}`);
    logger.info(`Trend: ${insights.performanceTrend}`);

    if (insights.opponentInsights.length > 0) {
      logger.info("=== Opponent Insights ===");
      for (const opp of insights.opponentInsights) {
        if (opp.insight) {
          logger.info(`${opp.walletAddress.slice(0, 8)}: ${opp.insight}`);
        }
      }
    }

    if (insights.suggestedAdjustments.length > 0) {
      logger.info("=== Suggested Adjustments ===");
      for (const adj of insights.suggestedAdjustments) {
        logger.info(`- ${adj}`);
      }
    }
  }
}
