/** Portable read capability for the identifier-backed email fork. */
export abstract class IdentityEmailService {
  /** Returns null when the caller must retain the legacy User.email value. */
  abstract resolveEmail(input: { userId: string }): Promise<string | null>;
}
