/**
 * Wallet Authentication - Signs messages for platform API requests
 *
 * Generates signed messages that match the platform's authentication requirements.
 */

import { Keypair } from "https://esm.sh/@solana/web3.js@1.98.2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import bs58 from "https://esm.sh/bs58@6.0.0";

export interface SignedRequest {
  headers: {
    "Content-Type": string;
    "x-wallet-address": string;
    "x-wallet-signature": string;
    "x-wallet-message-b64": string;
    "x-wallet-timestamp": string;
  };
  body: string;
}

/**
 * Create authentication headers for a platform API request
 */
export function createAuthHeaders(
  wallet: Keypair,
  sessionId: string,
  action: string,
  bodyData: Record<string, any>
): SignedRequest {
  const walletAddress = wallet.publicKey.toBase58();
  const timestamp = Date.now();

  // Build message matching platform format:
  // "Action: {action}\nSession: {sessionId}\nTimestamp: {timestamp}"
  const message = `Action: ${action}\nSession: ${sessionId}\nTimestamp: ${timestamp}`;

  // Sign the message
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = nacl.sign.detached(messageBytes, wallet.secretKey);
  const signature = bs58.encode(signatureBytes);

  // Encode message in base64 to avoid newline issues in HTTP headers
  const messageB64 = btoa(message);

  return {
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": walletAddress,
      "x-wallet-signature": signature,
      "x-wallet-message-b64": messageB64,
      "x-wallet-timestamp": timestamp.toString(),
    },
    body: JSON.stringify(bodyData),
  };
}

/**
 * Make an authenticated POST request to a Supabase Edge Function
 */
export async function authenticatedFetch(
  url: string,
  wallet: Keypair,
  sessionId: string,
  action: string,
  bodyData: Record<string, any>
): Promise<Response> {
  const { headers, body } = createAuthHeaders(wallet, sessionId, action, bodyData);

  return await fetch(url, {
    method: "POST",
    headers,
    body,
  });
}
