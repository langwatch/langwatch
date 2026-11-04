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

type KindToggles = { allowVk?: boolean; allowOtelDirect?: boolean; bundledPlan?: boolean };

/**
 * The toggles a kind switches off when picked: its locked ones, and for pi
 * the bundled plan, since pi runs on the provider keys it is given.
 */
function switchedOff(kind: AssistantKind): KindToggles {
  return { ...lockedToggles(kind), ...(kind === "pi" ? { bundledPlan: false } : {}) };
}

/**
 * What the drawer switches when an admin moves a tile from one kind to another:
 * the new kind's toggles off, and back to their default of on any the old kind
 * had switched off, so leaving pi does not strand the tile off a bundled plan.
 */
export function togglesOnKindChange({
  from,
  to,
}: {
  from: AssistantKind;
  to: AssistantKind;
}): KindToggles {
  const restored = Object.fromEntries(
    Object.keys(switchedOff(from)).map((toggle) => [toggle, true]),
  ) as KindToggles;
  return { ...restored, ...switchedOff(to) };
}
