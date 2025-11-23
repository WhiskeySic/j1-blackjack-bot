/**
 * Memory Manager - Persistent storage for Bob's learning
 *
 * Saves and loads Bob's memory (opponent profiles, experiences, performance data).
 */

import { BobMemory, OpponentProfile, GameExperience, SessionResult } from "../types.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";

export class MemoryManager {
  private readonly memoryFilePath: string;
  private memory: BobMemory;

  constructor(memoryFilePath: string = "./data/bob-memory.json") {
    this.memoryFilePath = memoryFilePath;
    this.memory = this.createEmptyMemory();
  }

  /**
   * Load Bob's memory from disk
   */
  async load(): Promise<BobMemory> {
    try {
      const data = await Deno.readTextFile(this.memoryFilePath);
      const loaded = JSON.parse(data);

      // Convert opponent profiles Map (stored as array)
      const profilesMap = new Map<string, OpponentProfile>();
      if (loaded.opponentProfiles && Array.isArray(loaded.opponentProfiles)) {
        for (const profile of loaded.opponentProfiles) {
          profilesMap.set(profile.walletAddress, profile);
        }
      }

      this.memory = {
        ...loaded,
        opponentProfiles: profilesMap,
      };

      logger.info(
        `[MemoryManager] Loaded memory: ${this.memory.totalSessionsPlayed} sessions, ` +
        `${this.memory.opponentProfiles.size} opponents`
      );

      return this.memory;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.info("[MemoryManager] No existing memory found, starting fresh");
        return this.memory;
      }

      logger.error("[MemoryManager] Error loading memory:", error);
      return this.memory;
    }
  }

  /**
   * Save Bob's memory to disk
   */
  async save(): Promise<void> {
    try {
      // Ensure data directory exists
      await this.ensureDataDirectory();

      // Convert Map to array for JSON serialization
      const serializable = {
        ...this.memory,
        opponentProfiles: Array.from(this.memory.opponentProfiles.values()),
        lastUpdated: Date.now(),
      };

      await Deno.writeTextFile(
        this.memoryFilePath,
        JSON.stringify(serializable, null, 2)
      );

      logger.debug("[MemoryManager] Memory saved successfully");
    } catch (error) {
      logger.error("[MemoryManager] Error saving memory:", error);
      throw error;
    }
  }

  /**
   * Get current memory
   */
  getMemory(): BobMemory {
    return this.memory;
  }

  /**
   * Update memory
   */
  updateMemory(updates: Partial<BobMemory>): void {
    this.memory = {
      ...this.memory,
      ...updates,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update opponent profiles
   */
  updateOpponentProfiles(profiles: Map<string, OpponentProfile>): void {
    this.memory.opponentProfiles = profiles;
  }

  /**
   * Update experiences
   */
  updateExperiences(experiences: GameExperience[], sessions: SessionResult[]): void {
    this.memory.recentExperiences = experiences;
    this.memory.recentSessions = sessions;
    this.memory.totalHandsPlayed += experiences.length;
  }

  /**
   * Update performance metrics
   */
  updatePerformance(sessionResult: SessionResult): void {
    const perf = this.memory.performance;

    // Add to rolling windows
    perf.winRateBySession.push(sessionResult.finalRank === 1 ? 1 : 0);
    perf.avgRankBySession.push(sessionResult.finalRank);
    perf.avgChipsBySession.push(sessionResult.finalChips);

    // Keep only last 100 sessions
    if (perf.winRateBySession.length > 100) {
      perf.winRateBySession.shift();
      perf.avgRankBySession.shift();
      perf.avgChipsBySession.shift();
    }

    // Update overall stats
    if (sessionResult.finalRank === 1) perf.totalWins++;
    if (sessionResult.finalRank <= 3) perf.totalTop3++;
    perf.totalProfit += sessionResult.netProfit;

    // Calculate win rates for comparison
    if (this.memory.totalSessionsPlayed <= 20) {
      // First 20 sessions - baseline
      const recentWins = perf.winRateBySession.filter(w => w === 1).length;
      perf.winRateBeforeLearning = recentWins / perf.winRateBySession.length;
    } else {
      // After 20 sessions - track recent performance
      const recent20 = perf.winRateBySession.slice(-20);
      const recentWins = recent20.filter(w => w === 1).length;
      perf.winRateAfterLearning = recentWins / recent20.length;
    }

    this.memory.totalSessionsPlayed++;
  }

  /**
   * Add strategy adjustment
   */
  addStrategyAdjustment(situation: string, adjustment: string, reason: string): void {
    this.memory.strategyAdjustments.push({
      timestamp: Date.now(),
      situation,
      adjustment,
      reason,
    });

    // Keep only last 50 adjustments
    if (this.memory.strategyAdjustments.length > 50) {
      this.memory.strategyAdjustments.shift();
    }
  }

  /**
   * Get learning effectiveness
   */
  getLearningEffectiveness(): {
    improving: boolean;
    improvementRate: number;
    sessionsPlayed: number;
  } {
    const perf = this.memory.performance;

    if (this.memory.totalSessionsPlayed < 20) {
      return {
        improving: false,
        improvementRate: 0,
        sessionsPlayed: this.memory.totalSessionsPlayed,
      };
    }

    const improvementRate = perf.winRateAfterLearning - perf.winRateBeforeLearning;

    return {
      improving: improvementRate > 0.05, // 5% improvement threshold
      improvementRate,
      sessionsPlayed: this.memory.totalSessionsPlayed,
    };
  }

  /**
   * Export memory for analysis
   */
  async exportToCSV(): Promise<void> {
    try {
      await this.ensureDataDirectory();

      // Export sessions
      const sessionCSV = this.sessionsToCSV();
      await Deno.writeTextFile("./data/bob-sessions.csv", sessionCSV);

      // Export opponent profiles
      const opponentsCSV = this.opponentsToCSV();
      await Deno.writeTextFile("./data/bob-opponents.csv", opponentsCSV);

      logger.info("[MemoryManager] Exported memory to CSV files");
    } catch (error) {
      logger.error("[MemoryManager] Error exporting CSV:", error);
    }
  }

  /**
   * Create empty memory structure
   */
  private createEmptyMemory(): BobMemory {
    return {
      version: "1.0.0",
      totalSessionsPlayed: 0,
      totalHandsPlayed: 0,
      learningEnabled: config.botEnabled,
      lastUpdated: Date.now(),
      opponentProfiles: new Map(),
      performance: {
        winRateBySession: [],
        avgRankBySession: [],
        avgChipsBySession: [],
        totalWins: 0,
        totalTop3: 0,
        totalProfit: 0,
        winRateBeforeLearning: 0,
        winRateAfterLearning: 0,
      },
      recentExperiences: [],
      recentSessions: [],
      strategyAdjustments: [],
    };
  }

  /**
   * Ensure data directory exists
   */
  private async ensureDataDirectory(): Promise<void> {
    try {
      await Deno.mkdir("./data", { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
  }

  /**
   * Convert sessions to CSV
   */
  private sessionsToCSV(): string {
    const headers = [
      "Session ID",
      "Final Rank",
      "Total Players",
      "Final Chips",
      "Hands Played",
      "Hands Won",
      "Net Profit",
      "Payout",
      "Completed At",
    ];

    const rows = this.memory.recentSessions.map(s => [
      s.sessionId,
      s.finalRank,
      s.totalPlayers,
      s.finalChips,
      s.handsPlayed,
      s.handsWon,
      s.netProfit,
      s.payout,
      new Date(s.completedAt).toISOString(),
    ]);

    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  }

  /**
   * Convert opponent profiles to CSV
   */
  private opponentsToCSV(): string {
    const headers = [
      "Wallet Address",
      "Sessions Played",
      "Bob Wins",
      "Opponent Wins",
      "Avg Bet Size",
      "Skill Score",
      "Aggression Score",
      "Weaknesses",
    ];

    const rows = Array.from(this.memory.opponentProfiles.values()).map(p => [
      p.walletAddress,
      p.sessionsPlayed,
      p.bobWins,
      p.opponentWins,
      p.stats.avgBetSize.toFixed(2),
      p.stats.skillScore.toFixed(2),
      p.stats.aggressionScore.toFixed(2),
      p.weaknesses.join(";"),
    ]);

    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  }
}
