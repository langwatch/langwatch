import type { ApiKeyScope, createApiKeyInputSchema } from "@langwatch/api-key-contract";
import { fromDate } from "@langwatch/time";
import type { z } from "zod";

import type { ApiKeyCreateRecord } from "../repositories/api-key.repository.ts";

/** The stored row a create writes: disabled until its grants land, then activated. */
export function createRecord({
  parsed,
  lookupId,
  hashedSecret,
  grants,
}: {
  parsed: z.output<typeof createApiKeyInputSchema>;
  lookupId: string;
  hashedSecret: string;
  grants: ApiKeyScope[];
}): ApiKeyCreateRecord {
  return {
    name: parsed.name,
    description: parsed.description ?? null,
    lookupId,
    hashedSecret,
    permissionMode: parsed.permissionMode ?? "default",
    userId: parsed.userId ?? null,
    createdByUserId: parsed.createdByUserId ?? null,
    createdByDeviceLabel: parsed.createdByDeviceLabel ?? null,
    parentApiKeyId: parsed.parentApiKeyId ?? null,
    organizationId: parsed.organizationId,
    expiresAt: parsed.expiresAt ? fromDate(parsed.expiresAt) : null,
    ingestSourceType: parsed.ingestSourceType ?? null,
    ingestionTemplateId: parsed.ingestionTemplateId ?? null,
    isSystemManaged: parsed.isSystemManaged ?? false,
    createdByBrowserSessionId: parsed.createdByBrowserSessionId ?? null,
    startsDisabled: true,
    grants,
  };
}
