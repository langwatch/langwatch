// Sharing is what keeps the key ledger small: a project that runs all day
// mints a few keys, not one per run, and one that runs nothing mints none.

/**
 * How long the runs of one project share a key before the next is minted.
 * Shorter than the key's own lifetime by a margin no run outlasts.
 */
export const AGENT_SANDBOX_KEY_REUSE_MS = 8 * 60 * 60 * 1000;

// A store that cannot read back what it holds answers `undefined` rather than
// raising: the caller mints a new key and shares that one from then on.

/**
 * The token a project's runs currently share. The database holds only its
 * hash, so this is the one place the plaintext survives the mint — for the
 * reuse window, and sealed.
 */
export abstract class AgentSandboxKeyShareRepository {
  abstract findSharedKey(input: { projectId: string }): Promise<string | undefined>;
  abstract hold(input: { projectId: string; token: string }): Promise<void>;
}
