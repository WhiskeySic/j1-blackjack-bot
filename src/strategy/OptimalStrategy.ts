/**
 * Optimal Strategy Engine - Statistical win probability calculations
 *
 * Calculates Expected Value (EV) for each possible action and chooses the best.
 * Integrates with card counting and learning system for adjustments.
 */

import { Card, BotDecision, GameSituation } from "../types.ts";
import { CardCounter } from "./CardCounter.ts";
import { logger } from "../utils/logger.ts";

export class OptimalStrategy {
  private cardCounter: CardCounter;

  constructor(cardCounter: CardCounter) {
    this.cardCounter = cardCounter;
  }

  /**
   * Get Bob's optimal decision for current situation
   */
  getDecision(
    situation: GameSituation,
    learningAdjustment: number = 0
  ): BotDecision {
    const { playerHand, playerTotal, isSoft, dealerUpcard, canDouble, canSplit } = situation;

    // Calculate EV for each possible action
    const standEV = this.calculateStandEV(playerTotal, this.getRankValue(dealerUpcard.rank));
    const hitEV = this.calculateHitEV(playerTotal, this.getRankValue(dealerUpcard.rank), isSoft);

    let doubleEV = -Infinity;
    if (canDouble) {
      doubleEV = this.calculateDoubleEV(playerTotal, this.getRankValue(dealerUpcard.rank), isSoft);
    }

    let splitEV = -Infinity;
    if (canSplit && playerHand.length === 2 && playerHand[0].rank === playerHand[1].rank) {
      splitEV = this.calculateSplitEV(playerHand[0].rank, this.getRankValue(dealerUpcard.rank));
    }

    // Apply learning adjustment (small modifier based on experience)
    const actions = [
      { action: 'stand' as const, ev: standEV + learningAdjustment },
      { action: 'hit' as const, ev: hitEV + learningAdjustment },
      { action: 'double' as const, ev: doubleEV + learningAdjustment },
      { action: 'split' as const, ev: splitEV + learningAdjustment },
    ];

    // Apply card counting modifier
    const countModifier = this.cardCounter.getStrategyModifier();
    for (const action of actions) {
      if (action.action === 'stand' && countModifier > 0) {
        action.ev += countModifier; // Positive count favors standing
      } else if (action.action === 'hit' && countModifier < 0) {
        action.ev += Math.abs(countModifier) * 0.5; // Negative count slightly favors hitting
      }
    }

    // Find best action
    actions.sort((a, b) => b.ev - a.ev);
    const bestAction = actions[0];
    const secondBestEV = actions[1].ev;

    // Calculate confidence (how much better is best vs second best)
    const confidence = Math.min(1.0, Math.max(0.0, (bestAction.ev - secondBestEV) / 0.5));

    // Get recommended bet size from card counter
    const betSize = this.cardCounter.getBet(situation.chipStack);

    logger.debug(
      `[Strategy] ${playerTotal}${isSoft ? ' (soft)' : ''} vs ${dealerUpcard.rank}: ` +
      `${bestAction.action} (EV: ${bestAction.ev.toFixed(3)}, confidence: ${(confidence * 100).toFixed(1)}%)`
    );

    if (this.cardCounter.isEnabled()) {
      this.cardCounter.logStatus();
    }

    return {
      action: bestAction.action,
      confidence,
      expectedValue: bestAction.ev,
      betSize,
    };
  }

  /**
   * Update card counter with observed card
   */
  observeCard(card: Card): void {
    this.cardCounter.updateCount(card);
  }

  /**
   * Reset card counter for new session
   */
  resetCount(): void {
    this.cardCounter.reset();
  }

  /**
   * Get card rank value
   */
  private getRankValue(rank: string): number {
    if (rank === 'A') return 11;
    if (['K', 'Q', 'J'].includes(rank)) return 10;
    return parseInt(rank);
  }

  /**
   * Calculate probability of dealer busting given upcard
   */
  private getDealerBustProbability(dealerUpcard: number): number {
    const bustProbs: { [key: number]: number } = {
      2: 0.3539,
      3: 0.3745,
      4: 0.4002,
      5: 0.4282,
      6: 0.4205,
      7: 0.2619,
      8: 0.2383,
      9: 0.2301,
      10: 0.2129,
      11: 0.1178, // Ace
    };
    return bustProbs[dealerUpcard] || 0.25;
  }

  /**
   * Get dealer's final hand distribution
   */
  private getDealerFinalDistribution(dealerUpcard: number): { [total: number]: number } {
    const distributions: { [upcard: number]: { [total: number]: number } } = {
      2: { 17: 0.1389, 18: 0.1311, 19: 0.1310, 20: 0.1176, 21: 0.0775, bust: 0.3539 },
      3: { 17: 0.1299, 18: 0.1299, 19: 0.1299, 20: 0.1164, 21: 0.0693, bust: 0.3745 },
      4: { 17: 0.1199, 18: 0.1199, 19: 0.1199, 20: 0.1152, 21: 0.1050, bust: 0.4002 },
      5: { 17: 0.1199, 18: 0.1169, 19: 0.1169, 20: 0.1070, 21: 0.1111, bust: 0.4282 },
      6: { 17: 0.1654, 18: 0.1061, 19: 0.1061, 20: 0.1061, 21: 0.0958, bust: 0.4205 },
      7: { 17: 0.3691, 18: 0.1378, 19: 0.0790, 20: 0.0790, 21: 0.0732, bust: 0.2619 },
      8: { 17: 0.1289, 18: 0.3594, 19: 0.1289, 20: 0.0727, 21: 0.0718, bust: 0.2383 },
      9: { 17: 0.1189, 18: 0.1060, 19: 0.3481, 20: 0.1189, 21: 0.0780, bust: 0.2301 },
      10: { 17: 0.1102, 18: 0.1102, 19: 0.1102, 20: 0.3438, 21: 0.1127, bust: 0.2129 },
      11: { 17: 0.1304, 18: 0.1304, 19: 0.1304, 20: 0.3045, 21: 0.1865, bust: 0.1178 },
    };
    return distributions[dealerUpcard] || distributions[10];
  }

  /**
   * Calculate EV of standing
   */
  private calculateStandEV(playerTotal: number, dealerUpcard: number): number {
    if (playerTotal > 21) return -1.0;

    if (playerTotal === 21) {
      const dealerDist = this.getDealerFinalDistribution(dealerUpcard);
      return dealerDist.bust;
    }

    const dealerDist = this.getDealerFinalDistribution(dealerUpcard);
    let ev = 0;

    ev += dealerDist.bust * 1.0;

    for (let dealerTotal = 17; dealerTotal <= 21; dealerTotal++) {
      const prob = dealerDist[dealerTotal] || 0;
      if (dealerTotal < playerTotal) {
        ev += prob * 1.0;
      } else if (dealerTotal === playerTotal) {
        ev += prob * 0.0;
      } else {
        ev += prob * -1.0;
      }
    }

    return ev;
  }

  /**
   * Calculate EV of hitting
   */
  private calculateHitEV(
    playerTotal: number,
    dealerUpcard: number,
    isSoft: boolean,
    depth: number = 0
  ): number {
    if (playerTotal > 21) return -1.0;
    if (depth > 5) return this.calculateStandEV(playerTotal, dealerUpcard);

    const cardProbs: { [value: number]: number } = {
      1: 32/416,
      2: 32/416,
      3: 32/416,
      4: 32/416,
      5: 32/416,
      6: 32/416,
      7: 32/416,
      8: 32/416,
      9: 32/416,
      10: 128/416,
    };

    let ev = 0;

    for (const [cardValueStr, prob] of Object.entries(cardProbs)) {
      const cardValue = parseInt(cardValueStr);
      let newTotal = playerTotal + cardValue;
      let newIsSoft = isSoft;

      if (cardValue === 1) {
        if (playerTotal + 11 <= 21) {
          newTotal = playerTotal + 11;
          newIsSoft = true;
        } else {
          newTotal = playerTotal + 1;
        }
      }

      if (newIsSoft && newTotal > 21) {
        newTotal -= 10;
        newIsSoft = false;
      }

      if (newTotal > 21) {
        ev += prob * -1.0;
      } else if (newTotal === 21) {
        ev += prob * this.calculateStandEV(21, dealerUpcard);
      } else {
        const standEV = this.calculateStandEV(newTotal, dealerUpcard);
        const hitAgainEV = this.calculateHitEV(newTotal, dealerUpcard, newIsSoft, depth + 1);
        ev += prob * Math.max(standEV, hitAgainEV);
      }
    }

    return ev;
  }

  /**
   * Calculate EV of doubling down
   */
  private calculateDoubleEV(
    playerTotal: number,
    dealerUpcard: number,
    isSoft: boolean
  ): number {
    const cardProbs: { [value: number]: number } = {
      1: 32/416,
      2: 32/416,
      3: 32/416,
      4: 32/416,
      5: 32/416,
      6: 32/416,
      7: 32/416,
      8: 32/416,
      9: 32/416,
      10: 128/416,
    };

    let ev = 0;

    for (const [cardValueStr, prob] of Object.entries(cardProbs)) {
      const cardValue = parseInt(cardValueStr);
      let newTotal = playerTotal + cardValue;

      if (cardValue === 1) {
        if (playerTotal + 11 <= 21) {
          newTotal = playerTotal + 11;
        } else {
          newTotal = playerTotal + 1;
        }
      }

      if (isSoft && newTotal > 21) {
        newTotal -= 10;
      }

      const standEV = this.calculateStandEV(newTotal, dealerUpcard);
      ev += prob * standEV * 2.0; // Doubled bet
    }

    return ev;
  }

  /**
   * Calculate EV of splitting
   */
  private calculateSplitEV(pairRank: string, dealerUpcard: number): number {
    const pairValue = this.getRankValue(pairRank);

    // Splitting Aces - get one card each
    if (pairRank === 'A') {
      const cardProbs: { [value: number]: number } = {
        1: 32/416,
        2: 32/416,
        3: 32/416,
        4: 32/416,
        5: 32/416,
        6: 32/416,
        7: 32/416,
        8: 32/416,
        9: 32/416,
        10: 128/416,
      };

      let evPerHand = 0;
      for (const [cardValueStr, prob] of Object.entries(cardProbs)) {
        const cardValue = parseInt(cardValueStr);
        let total = 11 + cardValue;
        if (total > 21) total = 1 + cardValue;
        evPerHand += prob * this.calculateStandEV(total, dealerUpcard);
      }

      return evPerHand * 2;
    }

    // Other pairs - simplified as hitting once per hand
    const singleHandValue = pairValue;
    const hitEV = this.calculateHitEV(singleHandValue, dealerUpcard, false);

    return hitEV * 2;
  }
}
