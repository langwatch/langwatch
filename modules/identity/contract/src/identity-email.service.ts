/** The identifier-backed address, or the instruction to keep the legacy `User.email` (ADR-146). */
export type IdentityEmailResolution = { kind: "resolved"; email: string } | { kind: "keep_legacy" };

/** Portable read capability for the identifier-backed email fork. */
export abstract class IdentityEmailService {
  abstract resolveEmail(input: { userId: string }): Promise<IdentityEmailResolution>;
}
