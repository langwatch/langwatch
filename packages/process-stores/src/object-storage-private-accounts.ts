/**
 * Main's per-organisation S3 family, `DATAPLANE_S3__<label>__<orgId>=<json>`, parsed once at boot
 * from the stores' secret family as the ClickHouse routes are (ARCHITECTURE.md §7). The JSON holds
 * credentials: an unusable entry is logged by its variable name, never its value.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import { z } from "zod";

import { DATAPLANE_S3_ENV_PREFIX } from "./config-owner.ts";
import type { ObjectStoragePrivateAccount } from "./config.ts";

const dataplaneS3Schema = z.object({
  endpoint: z.string().min(1, "endpoint must not be empty"),
  bucket: z.string().min(1, "bucket must not be empty"),
  accessKeyId: z.string().min(1, "accessKeyId must not be empty"),
  secretAccessKey: z.string().min(1, "secretAccessKey must not be empty"),
});

const storesLogger = createLogger("langwatch:stores:dataplane-s3");

/** Two family entries name one organisation: boot refuses rather than pick one, as main did. */
export class DuplicatePrivateStorageAccountError extends Error {
  constructor(
    readonly organizationId: string,
    readonly envVar: string,
  ) {
    super(
      `Duplicate private S3 config for organisation "${organizationId}": "${envVar}" conflicts with an earlier entry. Each organisation maps to exactly one S3 config.`,
    );
    this.name = "DuplicatePrivateStorageAccountError";
  }
}

/** The label is ignored: the organisation is whatever follows the last `__`. */
function organizationOf(envVar: string): string {
  const suffix = envVar.slice(DATAPLANE_S3_ENV_PREFIX.length);
  const separator = suffix.lastIndexOf("__");
  return separator >= 0 ? suffix.slice(separator + 2) : suffix;
}

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Each organisation's own S3 account, keyed by the organisation its variable names. */
export function objectStoragePrivateAccountsOf(options: {
  family: ReadonlyMap<string, string>;
  /** The shared `S3_REGION`, which main applied to every private account too. */
  region?: string;
  logger?: Pick<Logger, "warn">;
}): readonly ObjectStoragePrivateAccount[] {
  const { family, region, logger = storesLogger } = options;
  const accounts = new Map<string, ObjectStoragePrivateAccount>();

  for (const [envVar, value] of [...family].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const organizationId = organizationOf(envVar);
    if (!organizationId || !value) continue;

    const parsed = parsedJson(value);
    if (parsed === undefined) {
      logger.warn({ organizationId, envVar }, "Skipping private S3 config: invalid JSON");
      continue;
    }
    const result = dataplaneS3Schema.safeParse(parsed);
    if (!result.success) {
      const fields = Object.keys(result.error.flatten().fieldErrors);
      logger.warn({ organizationId, envVar, fields }, "Skipping private S3 config: invalid fields");
      continue;
    }
    if (accounts.has(organizationId)) {
      throw new DuplicatePrivateStorageAccountError(organizationId, envVar);
    }

    const { endpoint, bucket, accessKeyId, secretAccessKey } = result.data;
    accounts.set(organizationId, {
      organizationId,
      bucket,
      endpoint,
      ...(region ? { region } : {}),
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  return [...accounts.values()];
}
