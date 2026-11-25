/** Where an audit row came from, read from what the door stamped (E11, ARCHITECTURE.md). */
import { type AuditChannel, auditChannelSchema } from "@langwatch/organization-contract";
import { z } from "zod";

const SERVICE_KEY_PREFIX = "apikey:";

const originMetadataSchema = z.object({
  channel: auditChannelSchema.optional(),
  apiKeyId: z.string().optional(),
});

export type AuditOrigin = { channel: AuditChannel | null; apiKeyId: string | null };

/**
 * The door a row came through and the key it presented. Rows written before the stamp read
 * as the API when they carry its shape, as the app when they name a person, else neither.
 */
export function auditOriginOf({
  metadata,
  action,
  args,
  userId,
}: {
  metadata: unknown;
  action: string;
  args: unknown;
  userId: string | null;
}): AuditOrigin {
  const stamped = originMetadataSchema.safeParse(metadata).data;
  const serviceKeyId = userId?.startsWith(SERVICE_KEY_PREFIX)
    ? userId.slice(SERVICE_KEY_PREFIX.length)
    : void 0;
  return {
    channel: stamped?.channel ?? unstampedChannel({ action, args, userId }),
    apiKeyId: serviceKeyId ?? stamped?.apiKeyId ?? null,
  };
}

function unstampedChannel({
  action,
  args,
  userId,
}: {
  action: string;
  args: unknown;
  userId: string | null;
}): AuditOrigin["channel"] {
  if (action.startsWith("management.") || userId?.startsWith(SERVICE_KEY_PREFIX)) return "api";
  if (typeof args === "object" && args !== null && "scope" in args) return "api";
  return userId ? "app" : null;
}
