export type ScimTokenEntitlement =
  | { status: "invalid_token" }
  | { status: "plan_not_entitled"; organizationId: string }
  | { status: "ok"; organizationId: string };

export interface ScimTokenRecord {
  id: string;
  organizationId: string;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export type ScimTokenSummary = Pick<
  ScimTokenRecord,
  "id" | "description" | "createdAt" | "lastUsedAt"
>;

/** Portable SCIM token capability exposed to Enterprise composition roots. */
export abstract class ScimTokenService {
  abstract generate(input: {
    organizationId: string;
    description?: string | undefined;
  }): Promise<{ token: string; tokenId: string }>;

  abstract list(input: { organizationId: string }): Promise<ScimTokenSummary[]>;

  abstract revoke(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }>;

  abstract tryVerify(input: {
    token: string;
  }): Promise<{ organizationId: string } | null>;

  abstract verifyEntitled(input: { token: string }): Promise<ScimTokenEntitlement>;
}

export { ScimTokenService as ScimTokenCapability };
