/** The Json column's own shape, stated here so the walk names no Prisma type. */
export type BackfillJsonValue =
  | string
  | number
  | boolean
  | null
  | BackfillJsonValue[]
  | { [key: string]: BackfillJsonValue };

export type BackfillJsonObject = { [key: string]: BackfillJsonValue };

/** The scope types a key and a routing policy share, member for member. */
export type VirtualKeyScopeRow = Readonly<{
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}>;

/** The key with the scope rows the walk clones onto the new policy. */
export type VirtualKeyRow = Readonly<{
  id: string;
  name: string;
  organizationId: string;
  routingPolicyId: string | null;
  config: BackfillJsonValue | undefined;
  scopes: readonly VirtualKeyScopeRow[];
}>;

export type MintRoutingPolicyInput = Readonly<{
  id: string;
  organizationId: string;
  name: string;
  description: string;
  modelAliases: Record<string, string>;
  policyRules: BackfillJsonObject;
  scopes: readonly VirtualKeyScopeRow[];
}>;

export type MintGuardrailInput = Readonly<{
  projectId: string;
  name: string;
  evaluatorId: string;
  direction: "PRE" | "POST" | "STREAM_CHUNK";
  failureMode: "FAIL_OPEN" | "FAIL_CLOSED";
}>;

/**
 * The reads and writes the virtual-key config backfill makes. The walk goes
 * organization by organization because the tenancy guard needs a scope
 * predicate on every VirtualKey read.
 */
export abstract class GatewayVirtualKeyConfigBackfillRepository {
  abstract findOrganizationIds(): Promise<string[]>;

  abstract findVirtualKeys(input: { organizationId: string }): Promise<VirtualKeyRow[]>;

  abstract mintRoutingPolicy(input: MintRoutingPolicyInput): Promise<string>;

  abstract mintGuardrail(input: MintGuardrailInput): Promise<string>;

  abstract updateVirtualKeyConfig(input: {
    id: string;
    config: BackfillJsonObject;
    routingPolicyId: string | null;
  }): Promise<void>;
}
