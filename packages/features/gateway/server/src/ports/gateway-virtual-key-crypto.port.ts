/**
 * The virtual-key cipher, as the write path sees it: mint a secret, read its
 * display prefix back, and hash or verify one. The cipher itself is an
 * adapter, so a process composes the peppered implementation and the service
 * never reaches for it.
 */
export abstract class GatewayVirtualKeyCryptoPort {
  abstract mintSecret(nowMs?: number): string;
  abstract parseSecret(secret: string): { displayPrefix: string; ulid: string };
  abstract hashSecret(secret: string): string;
  abstract verifySecret(secret: string, hashedSecret: string): boolean;
}
