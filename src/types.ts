/**
 * Type definitions for Bob Bot
 */

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string; // '2'-'10', 'J', 'Q', 'K', 'A'
}

export type Action = 'hit' | 'stand' | 'double' | 'split';

export interface BotDecision {
  action: Action;
  confidence: number; // 0-1, how much better this action is vs alternatives
  expectedValue: number; // Expected chip return per chip bet
  betSize?: number; // Recommended bet size
}

export interface GameSituation {
  playerHand: Card[];
  playerTotal: number;
  isSoft: boolean;
  dealerUpcard: Card;
  trueCount: number;
  chipStack: number;
  currentRank: number;
  handsRemaining: number;
  canDouble: boolean;
  canSplit: boolean;
}

export interface GameExperience {
  // Situation
  sessionId: string;
  handNumber: number;
  playerHand: Card[];
  playerTotal: number;
  dealerUpcard: Card;
  dealerFinalHand?: Card[];
  dealerTotal?: number;
  trueCount: number;
  chipStack: number;
  currentRank: number;
  handsRemaining: number;

  // Action
  actionTaken: Action;
  betSize: number;

  // Outcome
  handResult: 'win' | 'loss' | 'push';
  chipsWon: number; // Can be negative

  // Meta
  timestamp: number;
  opponentWallets: string[]; // Other players in session
}

export interface SessionResult {
  sessionId: string;
  finalRank: number;
  totalPlayers: number;
  finalChips: number;
  handsPlayed: number;
  handsWon: number;
  totalWagered: number;
  netProfit: number; // chips gained/lost
  payout: number; // SOL payout

  // Opponents
  opponents: OpponentSessionData[];

  // Timestamp
  completedAt: number;
}

export interface OpponentSessionData {
  walletAddress: string;
  finalRank: number;
  finalChips: number;
  handsWon: number;

  // Observed behaviors this session
  avgBetSize: number;
  totalHits: number;
  totalStands: number;
  totalDoubles: number;
  totalSplits: number;
}

export interface OpponentProfile {
  walletAddress: string;
  displayName?: string;

  // Encounter history
  sessionsPlayed: number;
  lastSeenAt: number;
  firstSeenAt: number;

  // Win/Loss record against this opponent
  bobWins: number;
  opponentWins: number;

  // Behavioral statistics (aggregated across all sessions)
  stats: {
    avgBetSize: number;
    avgFinalChips: number;
    avgFinalRank: number;

    // Action frequencies
    hitFrequency: number; // hits per hand
    standFrequency: number;
    doubleFrequency: number;
    splitFrequency: number;

    // Behavioral scores
    aggressionScore: number; // 0-1 (based on bet sizing and risky plays)
    skillScore: number; // 0-1 (how close to optimal strategy)
    consistencyScore: number; // 0-1 (how predictable they are)
  };

  // Common patterns
  patterns: {
    // Specific tendencies (e.g., "always hits on 16 vs dealer 7")
    hitOn16VsDealer7: number; // % of observations
    standOn12VsDealer2: number;
    doubleOn11: number;
    splitAces: number;
    split10s: number; // Bad play indicator

    // Bet sizing patterns
    increaseBetAfterWin: number; // % of time
    increaseBetAfterLoss: number;

    // Risk tolerance
    averageRiskLevel: number; // 0-1
  };

  // Exploitable weaknesses
  weaknesses: string[]; // e.g., ["overly_aggressive", "bad_at_soft_hands"]
}

export interface BobMemory {
  version: string;

  // Learning metadata
  totalSessionsPlayed: number;
  totalHandsPlayed: number;
  learningEnabled: boolean;
  lastUpdated: number;

  // Opponent profiles
  opponentProfiles: Map<string, OpponentProfile>;

  // Performance tracking
  performance: {
    winRateBySession: number[]; // Last 100 sessions
    avgRankBySession: number[];
    avgChipsBySession: number[];

    // Overall stats
    totalWins: number; // 1st place finishes
    totalTop3: number;
    totalProfit: number; // Net SOL

    // Learning effectiveness
    winRateBeforeLearning: number; // First 20 sessions baseline
    winRateAfterLearning: number; // Recent 20 sessions
  };

  // Recent experiences (for analysis)
  recentExperiences: GameExperience[]; // Last 1000 hands
  recentSessions: SessionResult[]; // Last 100 sessions

  // Strategy adjustments learned
  strategyAdjustments: {
    timestamp: number;
    situation: string;
    adjustment: string;
    reason: string;
  }[];
}

export interface LearningInsights {
  // Session-level insights
  sessionInsights: {
    bestDecision: string; // e.g., "Doubled on 11 vs dealer 6 - won 200 chips"
    worstDecision: string;
    opponentsExploited: number; // How many weak plays did we capitalize on
    missedOpportunities: number;
  };

  // Opponent-level insights
  opponentInsights: {
    walletAddress: string;
    insight: string; // e.g., "Player always hits on 16 vs 7 - exploit by standing more"
  }[];

  // Overall trends
  performanceTrend: 'improving' | 'stable' | 'declining';
  suggestedAdjustments: string[];
}
