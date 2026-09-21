/**
 * The license sync of a connected install (ADR-141, section 6).
 *
 * One outbound call per organization holding a license: the token, the
 * instance id, the version this install runs and the two seat counts in use.
 * LangWatch answers with the services the license is entitled to and with a
 * reissued license when one is waiting, so a seat change or a renewal never
 * arrives as a key to paste. The sync runs once a day on its own, and an
 * admin runs it on demand from the License page (`syncLicenseNow`).
 *
 * Product statistics are a separate post with its own switch
 * (`usageStatsWorker`). This sync carries no statistics, no organization name
 * and no hostname, and it runs whether or not statistics are switched off.
 *
 * Nothing runs at all unless a license on this install names a hosted service.
 * An install on an offline license builds no client, resolves no credential
 * and opens no connection, and an operator proves that from the license blob
 * rather than from a deployment variable. `LANGWATCH_CONNECT_DISABLED` stops
 * it as well.
 *
 * @see ~/../ee/licensing/connect/install/connectLicenseClient.ts
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import { ConnectLicenseRequiredError } from "@ee/licensing/connect/errors";
import {
  type ConnectConfig,
  readConnectConfig,
} from "@ee/licensing/connect/install/connectConfig";
import { resolveConnectCredential } from "@ee/licensing/connect/install/connectCredential";
import { licenseConnectServices } from "@ee/licensing/connect/install/connectEntitlement";
import { ConnectDisabledError } from "@ee/licensing/connect/install/connectErrors";
import {
  type ConnectLicenseClient,
  getConnectLicenseClient,
} from "@ee/licensing/connect/install/connectLicenseClient";
import type { LicenseError } from "@ee/licensing/constants";
import { PUBLIC_KEY } from "@ee/licensing/constants";
import { licenseValidationError } from "@ee/licensing/errors";
import { createLicenseHandler } from "@ee/licensing/server";
import { parseLicenseKey } from "@ee/licensing/validation";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import {
  type ILicenseEnforcementRepository,
  LicenseEnforcementRepository,
} from "~/server/license-enforcement/license-enforcement.repository";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:workers:licenseSyncWorker");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first sync waits for the install to finish coming up. An install that
 * was restarted to fix a failing sync should not wait a day to find out.
 */
const FIRST_TICK_DELAY_MS = 2 * 60 * 1000;

export interface LicenseSyncWorkerHandle {
  stop(): void;
}

export interface LicenseSyncDependencies {
  /** Injected by suites; the process client otherwise. */
  readonly prisma?: PrismaClient;
  readonly config?: ConnectConfig;
  readonly client?: ConnectLicenseClient;
  /** Injected by suites; one reading this install's own tables otherwise. */
  readonly repository?: ILicenseEnforcementRepository;
  readonly publicKey?: string;
  readonly version?: string;
  readonly now?: () => Date;
}

/** What one sync of one organization did with the answer. */
export type LicenseSyncOutcome =
  | { outcome: "unchanged" }
  | { outcome: "updated"; maxMembers: number; expiresAt: string }
  | { outcome: "delivered_invalid"; error: LicenseError };

/** What an admin pressing refresh is told. */
export type LicenseRefreshResult = Exclude<
  LicenseSyncOutcome,
  { outcome: "delivered_invalid" }
>;

/**
 * The version this install reports.
 *
 * Deployments name it the way every other service on the box does, through
 * OpenTelemetry's resource attributes or `SERVICE_VERSION`. An install that
 * names none reports `unknown` rather than a number made up here.
 */
export function readInstallVersion(
  environment: Record<string, string | undefined> = process.env,
): string {
  const explicit = environment.SERVICE_VERSION?.trim();
  if (explicit) return explicit;

  for (const pair of (environment.OTEL_RESOURCE_ATTRIBUTES ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== "service.version") continue;
    const value = pair.slice(separator + 1).trim();
    if (value) return value;
  }

  return environment.npm_package_version?.trim() ?? "unknown";
}

/** One pass over every organization that has a license to sync. */
export async function syncLicensesForAllOrganizations(
  deps: LicenseSyncDependencies = {},
): Promise<void> {
  const config = deps.config ?? readConnectConfig();
  if (!config.permitted) return;

  const prisma = deps.prisma ?? defaultPrisma;
  const client = deps.client ?? getConnectLicenseClient(config.licenseEndpoint);
  const repository =
    deps.repository ?? new LicenseEnforcementRepository(prisma);

  for (const organizationId of await organizationsToSync(prisma)) {
    try {
      await syncOneOrganization({
        deps,
        prisma,
        client,
        repository,
        organizationId,
      });
    } catch (error) {
      await recordFailure({ prisma, organizationId, error });
    }
  }
}

/**
 * The sync an admin asks for from the License page, so a seat change made on
 * the registry reaches this install now rather than on the next daily pass.
 *
 * A refusal is thrown as the code the host named, after it was recorded the
 * way the daily pass records one, so Settings, Connect shows the same failure
 * either way. The registry's rate limit applies as it does to the daily sync.
 */
export async function syncLicenseNow({
  organizationId,
  ...deps
}: LicenseSyncDependencies & {
  organizationId: string;
}): Promise<LicenseRefreshResult> {
  const config = deps.config ?? readConnectConfig();
  if (!config.permitted) throw new ConnectDisabledError();

  const prisma = deps.prisma ?? defaultPrisma;
  const client = deps.client ?? getConnectLicenseClient(config.licenseEndpoint);
  const repository =
    deps.repository ?? new LicenseEnforcementRepository(prisma);

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { license: true },
  });
  if (
    licenseConnectServices({
      licenseKey: organization?.license ?? env.LANGWATCH_LICENSE_KEY ?? null,
    }).length === 0
  ) {
    throw new ConnectLicenseRequiredError();
  }

  let synced: LicenseSyncOutcome;
  try {
    synced = await syncOneOrganization({
      deps,
      prisma,
      client,
      repository,
      organizationId,
    });
  } catch (error) {
    await recordFailure({ prisma, organizationId, error });
    throw error;
  }

  if (synced.outcome === "delivered_invalid") {
    throw licenseValidationError(synced.error);
  }
  return synced;
}

/**
 * The organizations whose license names a hosted service: their own, or the
 * instance-wide one an operator set for the whole deployment.
 *
 * A license that names none is not synced, which is how an install on an
 * offline license makes no call.
 */
async function organizationsToSync(prisma: PrismaClient): Promise<string[]> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, license: true },
  });
  return organizations
    .filter(
      (organization) =>
        licenseConnectServices({
          licenseKey: organization.license ?? env.LANGWATCH_LICENSE_KEY ?? null,
        }).length > 0,
    )
    .map((organization) => organization.id);
}

async function syncOneOrganization({
  deps,
  prisma,
  client,
  repository,
  organizationId,
}: {
  deps: LicenseSyncDependencies;
  prisma: PrismaClient;
  client: ConnectLicenseClient;
  repository: ILicenseEnforcementRepository;
  organizationId: string;
}): Promise<LicenseSyncOutcome> {
  const credential = await resolveConnectCredential({ prisma, organizationId });
  if (!credential) return { outcome: "unchanged" };

  const answer = await client.syncLicense({
    credential,
    version: deps.version ?? readInstallVersion(),
    seats: await countSeats({ repository, organizationId }),
  });

  if (answer.license) {
    return await deliverLicense({
      deps,
      prisma,
      client,
      repository,
      organizationId,
      license: answer.license,
    });
  }

  await recordSuccess({ deps, prisma, organizationId });
  return { outcome: "unchanged" };
}

/** The seats in use, counted the way the seat guard counts them. */
async function countSeats({
  repository,
  organizationId,
}: {
  repository: ILicenseEnforcementRepository;
  organizationId: string;
}): Promise<{ members: number; liteMembers: number }> {
  const [members, liteMembers] = await Promise.all([
    repository.getMemberCount(organizationId),
    repository.getMembersLiteCount(organizationId),
  ]);
  return { members, liteMembers };
}

/**
 * A reissued license the answer carried.
 *
 * It goes through the same validate-and-store path a pasted key does, so a
 * license we did not sign is never stored. One more sync with the new token
 * is what tells the registry the replaced license is out of use.
 */
async function deliverLicense({
  deps,
  prisma,
  client,
  repository,
  organizationId,
  license,
}: {
  deps: LicenseSyncDependencies;
  prisma: PrismaClient;
  client: ConnectLicenseClient;
  repository: ILicenseEnforcementRepository;
  organizationId: string;
  license: string;
}): Promise<LicenseSyncOutcome> {
  const stored = await createLicenseHandler(
    prisma,
    deps.publicKey ?? PUBLIC_KEY,
  ).validateAndStoreLicense(organizationId, license);

  if (!stored.success) {
    await writeSync({
      prisma,
      organizationId,
      data: { connectLastSyncError: "license_key_invalid" },
      now: nowOf(deps),
    });
    return { outcome: "delivered_invalid", error: stored.error };
  }

  const renewed = await resolveConnectCredential({ prisma, organizationId });
  if (renewed) {
    await client.syncLicense({
      credential: renewed,
      version: deps.version ?? readInstallVersion(),
      seats: await countSeats({ repository, organizationId }),
    });
  }
  await recordSuccess({ deps, prisma, organizationId });

  return {
    outcome: "updated",
    maxMembers: stored.planInfo.maxMembers,
    expiresAt: parseLicenseKey(license)?.data.expiresAt ?? "",
  };
}

/** What a successful sync leaves behind: the time, and no failure. */
async function recordSuccess({
  deps,
  prisma,
  organizationId,
}: {
  deps: LicenseSyncDependencies;
  prisma: PrismaClient;
  organizationId: string;
}): Promise<void> {
  await writeSync({
    prisma,
    organizationId,
    now: nowOf(deps),
    data: { connectLastSyncError: null },
    touchSyncTime: true,
  });

  logger.info({ organizationId }, "license synced");
}

async function recordFailure({
  prisma,
  organizationId,
  error,
}: {
  prisma: PrismaClient;
  organizationId: string;
  error: unknown;
}): Promise<void> {
  const code = HandledError.isHandled(error)
    ? error.code
    : "license_sync_failed";
  logger.warn({ organizationId, code, error }, "license sync failed");

  await withScope(async (scope) => {
    scope.setTag?.("worker", "licenseSync");
    scope.setExtra?.("organizationId", organizationId);
    captureException(toError(error));
  });

  await writeSync({
    prisma,
    organizationId,
    now: new Date(),
    data: { connectLastSyncError: code },
  }).catch(() => undefined);
}

async function writeSync({
  prisma,
  organizationId,
  data,
  now,
  touchSyncTime = false,
}: {
  prisma: PrismaClient;
  organizationId: string;
  data: Prisma.OrganizationUpdateInput;
  now: Date;
  touchSyncTime?: boolean;
}): Promise<void> {
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      ...data,
      ...(touchSyncTime ? { connectLastSyncAt: now } : {}),
    },
  });
}

function nowOf(deps: LicenseSyncDependencies): Date {
  return deps.now?.() ?? new Date();
}

/**
 * The interval loop that runs the sync once a day.
 *
 * The loop starts whenever Connect is permitted, and each pass decides for
 * itself which organizations are entitled. An install whose licenses name no
 * hosted service walks an empty list and opens no connection, and a license
 * pasted while the process runs is picked up on the next pass rather than at
 * the next restart.
 */
export function startLicenseSyncWorker(
  deps: LicenseSyncDependencies = {},
): LicenseSyncWorkerHandle | undefined {
  const config = deps.config ?? readConnectConfig();
  if (!config.permitted) {
    logger.debug("connect is switched off, skipping the license sync worker");
    return undefined;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await syncLicensesForAllOrganizations({ ...deps, config });
    } catch (error) {
      logger.warn({ error }, "license sync tick failed, retrying tomorrow");
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), DAY_MS);
    }
  };

  timer = setTimeout(() => void tick(), FIRST_TICK_DELAY_MS);
  logger.info("license sync worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("license sync worker stopped");
    },
  };
}
