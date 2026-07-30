import { createHash } from "node:crypto";

/**
 * Kept apart from `serialization.ts` on purpose. That module's other exports
 * (`isRecord`, `stableStringify`, `UnknownRecord`) are pure and are read by
 * `canonical/attributes.ts`, which the coding-agent normalisation imports, which
 * the trace drawer imports — so 523 client entry points reach it. A top-level
 * `node:crypto` import there put the whole chain on the browser's module graph,
 * where Vite externalises it and the first property access throws. The hash is
 * the only part that needs Node, so it lives alone and only the server-side
 * callers (`shards.ts`, `canonical/buildPoint.ts`) pull it in.
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
