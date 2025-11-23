/**
 * Opponent Profiler - Learns player behavioral patterns
 *
 * Tracks opponent tendencies and identifies exploitable weaknesses.
 */

import { OpponentProfile, OpponentSessionData, GameExperience } from "../types.ts";
import { logger } from "../utils/logger.ts";

export class OpponentProfiler {
  private profiles: Map<string, OpponentProfile> = new Map();

  constructor(existingProfiles?: Map<string, OpponentProfile>) {
    if (existingProfiles) {
      this.profiles = existingProfiles;
      logger.info(`[OpponentProfiler] Loaded ${existingProfiles.size} opponent profiles`);
    }
  }

  /**
   * Update opponent profile after session
   */
  updateProfile(
    walletAddress: string,
    sessionData: OpponentSessionData,
    bobRank: number
  ): void {
    let profile = this.profiles.get(walletAddress);

    if (!profile) {
      // First time seeing this opponent
      profile = this.createNewProfile(walletAddress);
    }

    // Update encounter history
    profile.sessionsPlayed++;
    profile.lastSeenAt = Date.now();

    // Update win/loss record
    if (bobRank < sessionData.finalRank) {
      profile.bobWins++;
    } else if (bobRank > sessionData.finalRank) {
      profile.opponentWins++;
    }

    // Update statistics
    this.updateStats(profile, sessionData);

    // Calculate behavioral scores
    this.calculateScores(profile);

    // Identify weaknesses
    this.identifyWeaknesses(profile);

    // Save updated profile
    this.profiles.set(walletAddress, profile);

    logger.debug(
      `[OpponentProfiler] Updated profile for ${walletAddress.slice(0, 8)}... ` +
      `(${profile.sessionsPlayed} sessions, skill: ${profile.stats.skillScore.toFixed(2)})`
    );
  }

  /**
   * Update profile with observed hand actions
   */
  updateWithHandObservation(
    walletAddress: string,
    observation: {
      situation: string; // e.g., "16_vs_7"
      action: string;
      betSize?: number;
    }
  ): void {
    const profile = this.profiles.get(walletAddress);
    if (!profile) return;

    // Track specific patterns
    if (observation.situation === "16_vs_7" && observation.action === "hit") {
      profile.patterns.hitOn16VsDealer7 = this.updateFrequency(
        profile.patterns.hitOn16VsDealer7,
        1,
        profile.sessionsPlayed
      );
    } else if (observation.situation === "12_vs_2" && observation.action === "stand") {
      profile.patterns.standOn12VsDealer2 = this.updateFrequency(
        profile.patterns.standOn12VsDealer2,
        1,
        profile.sessionsPlayed
      );
    } else if (observation.situation === "11" && observation.action === "double") {
      profile.patterns.doubleOn11 = this.updateFrequency(
        profile.patterns.doubleOn11,
        1,
        profile.sessionsPlayed
      );
    } else if (observation.situation === "AA" && observation.action === "split") {
      profile.patterns.splitAces = this.updateFrequency(
        profile.patterns.splitAces,
        1,
        profile.sessionsPlayed
      );
    } else if (observation.situation === "TT" && observation.action === "split") {
      // Splitting 10s is almost always a bad play
      profile.patterns.split10s = this.updateFrequency(
        profile.patterns.split10s,
        1,
        profile.sessionsPlayed
      );
    }
  }

  /**
   * Get profile for opponent
   */
  getProfile(walletAddress: string): OpponentProfile | undefined {
    return this.profiles.get(walletAddress);
  }

  /**
   * Get all profiles
   */
  getAllProfiles(): Map<string, OpponentProfile> {
    return this.profiles;
  }

  /**
   * Get insights about an opponent
   */
  getOpponentInsights(walletAddress: string): string[] {
    const profile = this.profiles.get(walletAddress);
    if (!profile) return [];

    const insights: string[] = [];

    // Skill assessment
    if (profile.stats.skillScore < 0.3) {
      insights.push("Weak player - makes frequent mistakes");
    } else if (profile.stats.skillScore > 0.7) {
      insights.push("Strong player - plays near-optimal strategy");
    }

    // Aggression
    if (profile.stats.aggressionScore > 0.7) {
      insights.push("Aggressive bettor - can be exploited with conservative play");
    } else if (profile.stats.aggressionScore < 0.3) {
      insights.push("Conservative bettor - unlikely to take risks");
    }

    // Specific weaknesses
    if (profile.patterns.split10s > 0.1) {
      insights.push("MAJOR WEAKNESS: Splits 10s frequently (very bad play)");
    }

    if (profile.patterns.hitOn16VsDealer7 > 0.8) {
      insights.push("Always hits on 16 vs dealer 7 (slightly suboptimal)");
    }

    if (profile.patterns.doubleOn11 < 0.5) {
      insights.push("Doesn't double on 11 enough - misses value");
    }

    // Head-to-head record
    const totalGames = profile.bobWins + profile.opponentWins;
    if (totalGames > 5) {
      const winRate = (profile.bobWins / totalGames) * 100;
      insights.push(`Bob's win rate vs this player: ${winRate.toFixed(1)}%`);
    }

    return insights;
  }

  /**
   * Create new profile for first-time opponent
   */
  private createNewProfile(walletAddress: string): OpponentProfile {
    return {
      walletAddress,
      sessionsPlayed: 0,
      lastSeenAt: Date.now(),
      firstSeenAt: Date.now(),
      bobWins: 0,
      opponentWins: 0,
      stats: {
        avgBetSize: 0,
        avgFinalChips: 0,
        avgFinalRank: 0,
        hitFrequency: 0,
        standFrequency: 0,
        doubleFrequency: 0,
        splitFrequency: 0,
        aggressionScore: 0.5,
        skillScore: 0.5,
        consistencyScore: 0.5,
      },
      patterns: {
        hitOn16VsDealer7: 0,
        standOn12VsDealer2: 0,
        doubleOn11: 0,
        splitAces: 0,
        split10s: 0,
        increaseBetAfterWin: 0,
        increaseBetAfterLoss: 0,
        averageRiskLevel: 0.5,
      },
      weaknesses: [],
    };
  }

  /**
   * Update running statistics
   */
  private updateStats(profile: OpponentProfile, sessionData: OpponentSessionData): void {
    const n = profile.sessionsPlayed;

    // Running averages
    profile.stats.avgBetSize = this.runningAverage(
      profile.stats.avgBetSize,
      sessionData.avgBetSize,
      n
    );

    profile.stats.avgFinalChips = this.runningAverage(
      profile.stats.avgFinalChips,
      sessionData.finalChips,
      n
    );

    profile.stats.avgFinalRank = this.runningAverage(
      profile.stats.avgFinalRank,
      sessionData.finalRank,
      n
    );

    // Action frequencies (per hand)
    const totalActions = sessionData.totalHits + sessionData.totalStands +
                        sessionData.totalDoubles + sessionData.totalSplits;

    if (totalActions > 0) {
      profile.stats.hitFrequency = this.runningAverage(
        profile.stats.hitFrequency,
        sessionData.totalHits / totalActions,
        n
      );

      profile.stats.standFrequency = this.runningAverage(
        profile.stats.standFrequency,
        sessionData.totalStands / totalActions,
        n
      );

      profile.stats.doubleFrequency = this.runningAverage(
        profile.stats.doubleFrequency,
        sessionData.totalDoubles / totalActions,
        n
      );

      profile.stats.splitFrequency = this.runningAverage(
        profile.stats.splitFrequency,
        sessionData.totalSplits / totalActions,
        n
      );
    }
  }

  /**
   * Calculate behavioral scores
   */
  private calculateScores(profile: OpponentProfile): void {
    // Aggression score (0 = conservative, 1 = aggressive)
    // Based on avg bet size relative to typical (25-50 chips)
    const avgBetNormalized = Math.min(1, profile.stats.avgBetSize / 75);
    const doubleFreqNormalized = profile.stats.doubleFrequency * 2; // Doubling is aggressive
    profile.stats.aggressionScore = (avgBetNormalized + doubleFreqNormalized) / 2;

    // Skill score (0 = poor, 1 = expert)
    // Based on how close to optimal strategy
    let skillScore = 0.5; // Start neutral

    // Good plays increase score
    if (profile.patterns.doubleOn11 > 0.8) skillScore += 0.1;
    if (profile.patterns.splitAces > 0.8) skillScore += 0.1;
    if (profile.patterns.hitOn16VsDealer7 > 0.6) skillScore += 0.05;

    // Bad plays decrease score
    if (profile.patterns.split10s > 0.05) skillScore -= 0.3;
    if (profile.patterns.standOn12VsDealer2 > 0.6) skillScore -= 0.1;
    if (profile.stats.avgFinalRank > profile.sessionsPlayed * 0.6) skillScore -= 0.1;

    profile.stats.skillScore = Math.max(0, Math.min(1, skillScore));

    // Consistency score (0 = unpredictable, 1 = very consistent)
    // Higher variance in bet sizing = lower consistency
    profile.stats.consistencyScore = 0.7; // Default (we'd need more data for true calculation)
  }

  /**
   * Identify exploitable weaknesses
   */
  private identifyWeaknesses(profile: OpponentProfile): void {
    const weaknesses: string[] = [];

    if (profile.stats.aggressionScore > 0.75) {
      weaknesses.push("overly_aggressive");
    }

    if (profile.stats.aggressionScore < 0.25) {
      weaknesses.push("overly_conservative");
    }

    if (profile.stats.skillScore < 0.4) {
      weaknesses.push("poor_strategy");
    }

    if (profile.patterns.split10s > 0.05) {
      weaknesses.push("splits_tens");
    }

    if (profile.patterns.doubleOn11 < 0.5) {
      weaknesses.push("misses_double_opportunities");
    }

    if (profile.stats.doubleFrequency < 0.05) {
      weaknesses.push("rarely_doubles");
    }

    profile.weaknesses = weaknesses;
  }

  /**
   * Running average helper
   */
  private runningAverage(currentAvg: number, newValue: number, n: number): number {
    return (currentAvg * n + newValue) / (n + 1);
  }

  /**
   * Update frequency with exponential moving average
   */
  private updateFrequency(current: number, observed: number, weight: number): number {
    // Exponential moving average with weight based on observations
    const alpha = 1 / Math.max(1, weight);
    return current * (1 - alpha) + observed * alpha;
  }
}
