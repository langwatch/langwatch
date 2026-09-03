export type ScimTokenEntitlement =
  | { status: "invalid_token" }
  | { status: "plan_not_entitled"; organizationId: string }
  | { status: "ok"; organizationId: string; connectionId: string | null };

export interface ScimTokenRecord {
  id: string;
  organizationId: string;
  connectionId: string | null;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export type ScimTokenSummary = Pick<
  ScimTokenRecord,
  "id" | "connectionId" | "description" | "createdAt" | "lastUsedAt"
>;
