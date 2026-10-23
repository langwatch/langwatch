/**
 * Main's per-organisation S3 family, `DATAPLANE_S3__<label>__<orgId>=<json>`, parsed once at boot
 * from the stores' secret family as the ClickHouse routes are (ARCHITECTURE.md §7). The JSON holds
 * credentials: an unusable entry is logged by its variable name, never its value.
 */
import { privateRouteNameOf } from "@langwatch/clickhouse-client";
import { createLogger, type Logger } from "@langwatch/observability";
import { z } from "zod";

import { DATAPLANE_S3_ENV_PREFIX } from "./config-owner.ts";
import type { MalformedPrivateVariable, ObjectStoragePrivateAccount } from "./config.ts";

/** A `roleArn` is assumed through the pod's web-identity token and wins over a static key pair. */
const dataplaneS3Schema = z
  .object({
    endpoint: z.string().min(1, "endpoint must not be empty"),
    bucket: z.string().min(1, "bucket must not be empty"),
    accessKeyId: z.string().min(1, "accessKeyId must not be empty").optional(),
    secretAccessKey: z.string().min(1, "secretAccessKey must not be empty").optional(),
    roleArn: z.string().trim().min(1, "roleArn must not be empty").optional(),
  })
  .superRefine((config, ctx) => {
    if (config.roleArn) return;
    for (const key of ["accessKeyId", "secretAccessKey"] as const) {
      if (config[key]) continue;
      ctx.addIssue({ code: "custom", path: [key], message: `set roleArn, or ${key}` });
    }
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

/** The organisation is whatever follows the last `__`; the label is what precedes it. */
function nameOf(envVar: string): { label: string; organizationId: string } {
  return privateRouteNameOf({ prefix: DATAPLANE_S3_ENV_PREFIX, variable: envVar });
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
  return objectStoragePrivateFamilyOf(options).accounts;
}

/** One entry's parsed config, or undefined when it is unusable (warned by its name). */
function configOf({
  envVar,
  value,
  organizationId,
  logger,
}: {
  envVar: string;
  value: string;
  organizationId: string;
  logger: Pick<Logger, "warn">;
}): z.infer<typeof dataplaneS3Schema> | undefined {
  const parsed = value ? parsedJson(value) : undefined;
  if (parsed === undefined) {
    logger.warn({ organizationId, envVar }, "Skipping private S3 config: invalid JSON");
    return undefined;
  }
  const result = dataplaneS3Schema.safeParse(parsed);
  if (!result.success) {
    const fields = Object.keys(result.error.flatten().fieldErrors);
    logger.warn({ organizationId, envVar, fields }, "Skipping private S3 config: invalid fields");
    return undefined;
  }
  return result.data;
}

/** The role when one is named, else the key pair the schema guarantees is then complete. */
function credentialsOf(
  config: z.infer<typeof dataplaneS3Schema>,
): Pick<ObjectStoragePrivateAccount, "roleArn" | "credentials"> {
  const { roleArn, accessKeyId, secretAccessKey } = config;
  if (roleArn) return { roleArn };
  if (!accessKeyId || !secretAccessKey) return {};

  return { credentials: { accessKeyId, secretAccessKey } };
}

/** The private accounts, and the variables present but unusable: those are refused. */
export function objectStoragePrivateFamilyOf(options: {
  family: ReadonlyMap<string, string>;
  region?: string;
  logger?: Pick<Logger, "warn">;
}): {
  accounts: readonly ObjectStoragePrivateAccount[];
  malformed: readonly MalformedPrivateVariable[];
} {
  const { family, region, logger = storesLogger } = options;
  const accounts = new Map<string, ObjectStoragePrivateAccount>();
  const malformed = new Map<string, MalformedPrivateVariable>();

  for (const [envVar, value] of [...family].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const { label, organizationId } = nameOf(envVar);
    if (!organizationId) continue;

    const config = configOf({ envVar, value, organizationId, logger });
    if (config === undefined) {
      if (!accounts.has(organizationId)) {
        malformed.set(organizationId, { organizationId, label, variable: envVar });
      }
      continue;
    }
    if (accounts.has(organizationId)) {
      throw new DuplicatePrivateStorageAccountError(organizationId, envVar);
    }

    malformed.delete(organizationId);
    accounts.set(organizationId, {
      organizationId,
      label,
      variable: envVar,
      bucket: config.bucket,
      endpoint: config.endpoint,
      ...(region ? { region } : {}),
      ...credentialsOf(config),
      forcePathStyle: true,
    });
  }

  return { accounts: [...accounts.values()], malformed: [...malformed.values()] };
}
