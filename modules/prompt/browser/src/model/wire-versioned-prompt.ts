import type { WireOf } from "@langwatch/api/web";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

/**
 * A versioned prompt the way the browser holds one. The contract's
 * `VersionedPrompt` states `versionCreatedAt: Date` (the server's shape),
 * but nothing transforms the wire, so this is the ISO-string type web code should name.
 */
export type WireVersionedPrompt = WireOf<VersionedPrompt>;
