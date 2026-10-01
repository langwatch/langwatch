import type { DeclaredScopeTier, ScopeTierField } from "./scope-tiers.ts";

export type AuthzScopeLineageInput = Readonly<Partial<Record<ScopeTierField, unknown>>>;

export type AuthzScopeLineageEntry = Readonly<{
  tier: DeclaredScopeTier;
  id: string;
  organizationId: string | null;
}>;

export type AuthzScopeLineageResult =
  | Readonly<{ kind: "consistent" }>
  | Readonly<{
      kind: "mismatch";
      widest: Readonly<{ tier: DeclaredScopeTier; id: string }>;
      entries: readonly AuthzScopeLineageEntry[];
    }>;
