/** The session version every tRPC answer carries (dev/docs/adr/164-browser-query-cache-tiers.md).
 */

export const SESSION_VERSION_HEADER = "x-lw-session-version";

/** Where a caller's session version is read; the authz module answers it. */
export type TrpcSessionVersions = Readonly<{
  getSessionVersion(input: { userId: string }): Promise<number>;
}>;
