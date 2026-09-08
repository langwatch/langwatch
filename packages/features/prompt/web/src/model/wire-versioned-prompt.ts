import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { WireOf } from "@langwatch/api/web";

/**
 * A versioned prompt the way the browser holds one.
 *
 * The contract's `VersionedPrompt` states `versionCreatedAt: Date`, which is
 * what the server holds. Nothing transforms the wire, so what arrives is the
 * ISO string, and this is the type web code should name. Parse the field at the
 * one place a real `Date` is needed.
 */
export type WireVersionedPrompt = WireOf<VersionedPrompt>;
