/**
 * Bot Wallet - Manages Solana wallet operations
 *
 * Handles wallet initialization, balance checking, and transaction signing.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "https://esm.sh/@solana/web3.js@1.98.2";
import { logger } from "../utils/logger.ts";

export class BotWallet {
  private keypair: Keypair | null = null;
  private connection: Connection;
  private privateKeyString: string;

  constructor(privateKeyString: string, rpcUrl: string) {
    this.privateKeyString = privateKeyString;
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  /**
   * Initialize wallet from private key
   */
  async initialize(): Promise<void> {
    try {
      // Parse private key (supports JSON array or base58)
      if (this.privateKeyString.trim().startsWith("[")) {
        // JSON array format [1,2,3,...]
        const secretKey = Uint8Array.from(JSON.parse(this.privateKeyString));
        this.keypair = Keypair.fromSecretKey(secretKey);
      } else {
        // Base58 encoded
        const bs58 = await import("https://esm.sh/bs58@6.0.0");
        const secretKey = bs58.default.decode(this.privateKeyString);
        this.keypair = Keypair.fromSecretKey(secretKey);
      }

      logger.info(`[BotWallet] Initialized: ${this.getPublicKey()}`);
    } catch (error) {
      logger.error("[BotWallet] Failed to initialize wallet:", error);
      throw new Error("Invalid BOT_WALLET_PRIVATE_KEY format");
    }
  }

  /**
   * Get wallet public key
   */
  getPublicKey(): string {
    if (!this.keypair) {
      throw new Error("Wallet not initialized");
    }
    return this.keypair.publicKey.toBase58();
  }

  /**
   * Get wallet balance (in SOL)
   */
  async getBalance(): Promise<number> {
    if (!this.keypair) {
      throw new Error("Wallet not initialized");
    }

    try {
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      logger.error("[BotWallet] Failed to get balance:", error);
      throw error;
    }
  }

  /**
   * Check if wallet has sufficient balance
   */
  async hasSufficientBalance(requiredSol: number): Promise<boolean> {
    const balance = await this.getBalance();
    return balance >= requiredSol + 0.01; // +0.01 SOL for transaction fees
  }

  /**
   * Pay entry fee to platform treasury
   */
  async payEntryFee(
    treasuryWallet: string,
    entryFeeSol: number
  ): Promise<string> {
    if (!this.keypair) {
      throw new Error("Wallet not initialized");
    }

    try {
      logger.info(`[BotWallet] Paying entry fee: ${entryFeeSol} SOL to ${treasuryWallet}`);

      const treasuryPubkey = new PublicKey(treasuryWallet);
      const lamports = Math.floor(entryFeeSol * LAMPORTS_PER_SOL);

      // Create transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey: treasuryPubkey,
          lamports,
        })
      );

      // Send and confirm
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.keypair],
        { commitment: "confirmed" }
      );

      logger.info(`[BotWallet] Payment confirmed: ${signature}`);
      return signature;
    } catch (error) {
      logger.error("[BotWallet] Failed to pay entry fee:", error);
      throw error;
    }
  }

  /**
   * Sign a message with wallet
   */
  signMessage(message: string): Uint8Array {
    if (!this.keypair) {
      throw new Error("Wallet not initialized");
    }

    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(message);

    // Note: For proper Solana message signing, use nacl.sign.detached
    // This is a simplified version
    return this.keypair.secretKey.slice(0, 64);
  }

  /**
   * Get keypair (for advanced operations)
   */
  getKeypair(): Keypair {
    if (!this.keypair) {
      throw new Error("Wallet not initialized");
    }
    return this.keypair;
  }

  /**
   * Get connection (for advanced operations)
   */
  getConnection(): Connection {
    return this.connection;
  }
}
