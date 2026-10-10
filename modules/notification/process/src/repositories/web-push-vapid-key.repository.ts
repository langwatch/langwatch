/** A VAPID key pair: both halves base64url, the public one an uncompressed P-256 point. */
export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * This installation's one VAPID key pair. The private key is stored encrypted; this
 * repository answers it decrypted.
 */
export interface WebPushVapidKeyRepository {
  find(): Promise<VapidKeyPair | null>;
  /**
   * Stores the pair unless one is already stored, and answers the stored one: two
   * processes generating at once both end up with the pair that won the insert.
   */
  insertIfAbsent(pair: VapidKeyPair): Promise<VapidKeyPair>;
}
