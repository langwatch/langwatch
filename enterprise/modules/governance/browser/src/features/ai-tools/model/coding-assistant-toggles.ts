import type { AssistantKind } from "../../../model/coding-agent/assistant-presets.ts";

type LockedToggles = { allowVk?: false; allowOtelDirect?: false };

/**
 * The CLI-path toggles a coding-assistant kind fixes, whatever a stored tile or
 * the admin says. pi fixes every model's address in its own build, so a gateway
 * key never applies. Cursor is GUI-only, so direct OTLP never applies.
 */
export function lockedToggles(kind: AssistantKind): LockedToggles {
  if (kind === "pi") return { allowVk: false };
  if (kind === "cursor") return { allowOtelDirect: false };
  return {};
}

/**
 * What the drawer switches when an admin picks a kind: the locked toggles, and
 * for pi the bundled plan too, since pi runs on the provider keys it is given.
 */
export function togglesOnKindChange(kind: AssistantKind): LockedToggles & { bundledPlan?: false } {
  return { ...lockedToggles(kind), ...(kind === "pi" ? { bundledPlan: false } : {}) };
}
