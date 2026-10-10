/** How long a sandbox key stays valid: long enough to outlast a run, worth little once leaked. */
export const AGENT_SANDBOX_KEY_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How long a project's runs share one key before the next is minted: shorter than the key's
 * life by a margin no run outlasts, so a run picking it up late still holds hours of it.
 */
export const AGENT_SANDBOX_KEY_REUSE_MS = 8 * 60 * 60 * 1000;
