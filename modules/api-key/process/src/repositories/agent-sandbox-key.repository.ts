/** The held token is there but cannot be opened: the cipher changed, or the value was damaged. */
export class AgentSandboxKeyUnreadableError extends Error {
  override readonly name = "AgentSandboxKeyUnreadableError";

  constructor(options: { cause: unknown }) {
    super("The shared agent sandbox key cannot be read back", { cause: options.cause });
  }
}

/** What seals a held token at rest: the process's cipher (rulings, "encryption"). */
export type AgentSandboxKeyCipher = Readonly<{
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}>;

/**
 * The token each project's code agent runs currently share. The database holds only the key's
 * hash, so this is the one place the plaintext survives the mint, and only for `ttlMs`.
 */
export abstract class AgentSandboxKeyRepository {
  /** The held token, or none; {@link AgentSandboxKeyUnreadableError} when it cannot be opened. */
  abstract findTokens(input: { projectId: string }): Promise<string[]>;
  /** Holds the token for `ttlMs`, replacing whatever the project held. */
  abstract hold(input: { projectId: string; token: string; ttlMs: number }): Promise<void>;
}
