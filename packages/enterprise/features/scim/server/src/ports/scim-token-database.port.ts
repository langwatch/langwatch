import type { ScimTokenRecord } from "@langwatch/enterprise-scim-contract";

export interface ScimTokenDatabase {
  scimToken: {
    create(input: { data: { organizationId: string; hashedToken: string; description: string | null } }): Promise<{ id: string }>;
    findMany(input: object): Promise<Array<Pick<ScimTokenRecord, "id" | "description" | "createdAt" | "lastUsedAt">>>;
    deleteMany(input: object): Promise<{ count: number }>;
    findFirst(input: object): Promise<Pick<ScimTokenRecord, "id" | "organizationId"> | null>;
    updateMany(input: object): Promise<unknown>;
  };
}
