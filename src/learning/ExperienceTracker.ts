/**
 * Experience Tracker - Records and analyzes game experiences
 *
 * Tracks every hand Bob plays for learning and analysis.
 */

import { GameExperience, SessionResult, LearningInsights } from "../types.ts";
import { logger } from "../utils/logger.ts";

export class ExperienceTracker {
  private experiences: GameExperience[] = [];
  private sessions: SessionResult[] = [];
  private readonly maxExperiences: number = 1000; // Keep last 1000 hands
  private readonly maxSessions: number = 100; // Keep last 100 sessions

  constructor(
    existingExperiences?: GameExperience[],
    existingSessions?: SessionResult[]
  ) {
    if (existingExperiences) {
      this.experiences = existingExperiences;
    }
    if (existingSessions) {
      this.sessions = existingSessions;
    }

    logger.info(
      `[ExperienceTracker] Loaded ${this.experiences.length} hands, ` +
      `${this.sessions.length} sessions`
    );
  }

  /**
   * Record a hand experience
   */
  recordHand(experience: GameExperience): void {
    this.experiences.push(experience);

    // Limit buffer size
    if (this.experiences.length > this.maxExperiences) {
      this.experiences.shift(); // Remove oldest
    }

    logger.debug(
      `[ExperienceTracker] Recorded hand ${experience.handNumber} in session ${experience.sessionId}: ` +
      `${experience.actionTaken} -> ${experience.handResult} (${experience.chipsWon >= 0 ? '+' : ''}${experience.chipsWon} chips)`
    );
  }

  /**
   * Record a session result
   */
  recordSession(session: SessionResult): void {
    this.sessions.push(session);

    // Limit buffer size
    if (this.sessions.length > this.maxSessions) {
      this.sessions.shift(); // Remove oldest
    }

    logger.info(
      `[ExperienceTracker] Recorded session ${session.sessionId}: ` +
      `Rank ${session.finalRank}/${session.totalPlayers}, ` +
      `${session.finalChips} chips, ` +
      `${session.handsWon}/${session.handsPlayed} hands won`
    );
  }

  /**
   * Get all experiences
   */
  getExperiences(): GameExperience[] {
    return this.experiences;
  }

  /**
   * Get all sessions
   */
  getSessions(): SessionResult[] {
    return this.sessions;
  }

  /**
   * Analyze recent performance
   */
  analyzePerformance(recentSessionCount: number = 20): {
    winRate: number;
    avgRank: number;
    avgChips: number;
    totalProfit: number;
  } {
    const recentSessions = this.sessions.slice(-recentSessionCount);

    if (recentSessions.length === 0) {
      return { winRate: 0, avgRank: 0, avgChips: 0, totalProfit: 0 };
    }

    const wins = recentSessions.filter(s => s.finalRank === 1).length;
    const totalRank = recentSessions.reduce((sum, s) => sum + s.finalRank, 0);
    const totalChips = recentSessions.reduce((sum, s) => sum + s.finalChips, 0);
    const totalProfit = recentSessions.reduce((sum, s) => sum + s.netProfit, 0);

    return {
      winRate: wins / recentSessions.length,
      avgRank: totalRank / recentSessions.length,
      avgChips: totalChips / recentSessions.length,
      totalProfit,
    };
  }

  /**
   * Generate insights from recent session
   */
  generateSessionInsights(sessionId: string): LearningInsights['sessionInsights'] {
    const sessionHands = this.experiences.filter(e => e.sessionId === sessionId);

    if (sessionHands.length === 0) {
      return {
        bestDecision: "No data",
        worstDecision: "No data",
        opponentsExploited: 0,
        missedOpportunities: 0,
      };
    }

    // Find best decision (highest chips won)
    const bestHand = sessionHands.reduce((best, current) =>
      current.chipsWon > best.chipsWon ? current : best
    );

    // Find worst decision (most chips lost)
    const worstHand = sessionHands.reduce((worst, current) =>
      current.chipsWon < worst.chipsWon ? current : worst
    );

    // Count how many hands we won
    const handsWon = sessionHands.filter(h => h.handResult === 'win').length;

    // Estimate missed opportunities (hands where we bet min but won)
    const missedOpportunities = sessionHands.filter(
      h => h.handResult === 'win' && h.betSize === 25
    ).length;

    return {
      bestDecision: `${bestHand.actionTaken} on ${bestHand.playerTotal} vs dealer ${bestHand.dealerUpcard.rank} - won ${bestHand.chipsWon} chips`,
      worstDecision: `${worstHand.actionTaken} on ${worstHand.playerTotal} vs dealer ${worstHand.dealerUpcard.rank} - lost ${Math.abs(worstHand.chipsWon)} chips`,
      opponentsExploited: handsWon,
      missedOpportunities,
    };
  }

  /**
   * Analyze action effectiveness
   */
  analyzeActionEffectiveness(): {
    action: string;
    totalUses: number;
    winRate: number;
    avgChipsWon: number;
  }[] {
    const actionStats = new Map<string, { wins: number; total: number; totalChips: number }>();

    for (const exp of this.experiences) {
      const key = exp.actionTaken;
      const stats = actionStats.get(key) || { wins: 0, total: 0, totalChips: 0 };

      stats.total++;
      stats.totalChips += exp.chipsWon;
      if (exp.handResult === 'win') {
        stats.wins++;
      }

      actionStats.set(key, stats);
    }

    return Array.from(actionStats.entries()).map(([action, stats]) => ({
      action,
      totalUses: stats.total,
      winRate: stats.wins / stats.total,
      avgChipsWon: stats.totalChips / stats.total,
    }));
  }

  /**
   * Identify performance trend
   */
  getPerformanceTrend(): 'improving' | 'stable' | 'declining' {
    if (this.sessions.length < 10) {
      return 'stable'; // Not enough data
    }

    // Compare first half vs second half of recent sessions
    const mid = Math.floor(this.sessions.length / 2);
    const firstHalf = this.sessions.slice(0, mid);
    const secondHalf = this.sessions.slice(mid);

    const firstHalfWinRate = firstHalf.filter(s => s.finalRank === 1).length / firstHalf.length;
    const secondHalfWinRate = secondHalf.filter(s => s.finalRank === 1).length / secondHalf.length;

    const improvement = secondHalfWinRate - firstHalfWinRate;

    if (improvement > 0.1) return 'improving';
    if (improvement < -0.1) return 'declining';
    return 'stable';
  }

  /**
   * Get experiences for specific situation
   */
  getExperiencesForSituation(
    playerTotal: number,
    dealerUpcardRank: string
  ): GameExperience[] {
    return this.experiences.filter(
      e => e.playerTotal === playerTotal && e.dealerUpcard.rank === dealerUpcardRank
    );
  }

  /**
   * Calculate learned EV adjustment for a situation
   */
  getLearnedEVAdjustment(
    playerTotal: number,
    dealerUpcardRank: string,
    action: string
  ): number {
    const relevantExperiences = this.experiences.filter(
      e =>
        e.playerTotal === playerTotal &&
        e.dealerUpcard.rank === dealerUpcardRank &&
        e.actionTaken === action
    );

    if (relevantExperiences.length < 5) {
      return 0; // Not enough data
    }

    // Calculate actual average outcome
    const avgOutcome = relevantExperiences.reduce((sum, e) => sum + e.chipsWon, 0) /
                      relevantExperiences.length;

    // Normalize to -1 to +1 range (typical hand outcomes)
    return Math.max(-0.2, Math.min(0.2, avgOutcome / 100));
  }

  /**
   * Get summary statistics
   */
  getSummaryStats() {
    const totalHands = this.experiences.length;
    const totalSessions = this.sessions.length;

    if (totalSessions === 0) {
      return {
        totalHands: 0,
        totalSessions: 0,
        overallWinRate: 0,
        avgRank: 0,
        avgChips: 0,
        totalProfit: 0,
      };
    }

    const wins = this.sessions.filter(s => s.finalRank === 1).length;
    const totalRank = this.sessions.reduce((sum, s) => sum + s.finalRank, 0);
    const totalChips = this.sessions.reduce((sum, s) => sum + s.finalChips, 0);
    const totalProfit = this.sessions.reduce((sum, s) => sum + s.netProfit, 0);

    return {
      totalHands,
      totalSessions,
      overallWinRate: wins / totalSessions,
      avgRank: totalRank / totalSessions,
      avgChips: totalChips / totalSessions,
      totalProfit,
    };
  }
}
