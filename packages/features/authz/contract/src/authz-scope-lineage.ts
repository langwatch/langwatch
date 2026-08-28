import type { BindingScopeTier, ScopeTierField } from "./vocabulary";

export type AuthzScopeLineageInput = Readonly<Partial<Record<ScopeTierField, unknown>>>;

export type AuthzScopeLineageEntry = Readonly<{
  tier: BindingScopeTier;
  id: string;
  organizationId: string | null;
}>;

export type AuthzScopeLineageResult =
  | Readonly<{ kind: "consistent" }>
  | Readonly<{
      kind: "mismatch";
      widest: Readonly<{ tier: BindingScopeTier; id: string }>;
      entries: readonly AuthzScopeLineageEntry[];
    }>;
