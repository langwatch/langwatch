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
