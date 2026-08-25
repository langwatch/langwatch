export abstract class ApiKeyTokenPort {
  abstract generate(options?: { prefix?: string }): {
    token: string;
    lookupId: string;
    hashedSecret: string;
  };
  abstract generateLegacyProjectKey(): string;
  abstract verify(
    secret: string,
    hashedSecret: string,
  ): "match" | "match_legacy" | "no_match";
  abstract hash(secret: string): string;
  abstract trySplit(token: string): { lookupId: string; secret: string } | null;
}
