import { z } from "zod";

/**
 * The three universal scope tiers every cross-cutting configuration resource
 * targets. This is the API/UI contract: a scope assignment coming over the wire
 * or rendered in the picker is always one of these tiers.
 *
 * Budget-only extensions (`VIRTUAL_KEY`, `PRINCIPAL`) are deliberately NOT part
 * of this contract — they stay on `GatewayBudget`'s own per-table storage enum
 * so a resource that cannot be scoped to a virtual key is physically unable to
 * hold that value. See ADR-021 and dev/docs/best_practices/scoped-resources.md
 * for why storage enums stay per-table while this value-type is shared.
 */
export const SCOPE_TIERS = ["ORGANIZATION", "TEAM", "PROJECT"] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];

/**
 * The canonical scope-assignment shape: which tier, and the id of the
 * Organization / Team / Project the row points at. Single source of truth for
 * the tRPC input schemas, the TypeScript SDK wire format, the `ScopeChipPicker`
 * UI, and every resolver.
 *
 * The shape is camelCase end-to-end (`scopeType` / `scopeId`). ADR-021 resolves
 * the historical SDK snake_case divergence (`scope_type` / `scope_id`) to
 * camelCase; the sync layer passes these values through verbatim and never
 * transforms or defaults them.
 */
export const scopeAssignmentSchema = z.object({
  scopeType: z.enum(SCOPE_TIERS),
  scopeId: z.string().min(1),
});
export type ScopeAssignment = z.infer<typeof scopeAssignmentSchema>;
