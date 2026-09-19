/**
 * The daily license sync of a connected install (ADR-139, section 6).
 *
 * One outbound call per organization holding a license: the token, the
 * instance id, the version this install runs and the two seat counts in use.
 * LangWatch answers with a signed lease, which is what lets the install go
 * over its licensed seats by the agreed allowance, and with a reissued license
 * when one is waiting, so a renewal never arrives as a key to paste.
 *
 * Product statistics are a separate post with its own switch
 * (`usageStatsWorker`). This sync carries no statistics, no organization name
 * and no hostname, and it runs whether or not statistics are switched off.
 *
 * Nothing runs at all unless an operator switched Connect on: with it off the
 * start function returns before a client is built, a credential is resolved or
 * a connection is opened.
 *
 * @see ~/../ee/licensing/connect/install/connectLicenseClient.ts
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import {
  type ConnectConfig,
  readConnectConfig,
} from "@ee/licensing/connect/install/connectConfig";
import { resolveConnectCredential } from "@ee/licensing/connect/install/connectCredential";
import {
  type ConnectLicenseClient,
  getConnectLicenseClient,
} from "@ee/licensing/connect/install/connectLicenseClient";
import type { ConnectCredential } from "@ee/licensing/connect/install/connectTransport";
import { verifyLease } from "@ee/licensing/connect/lease";
import { PUBLIC_KEY } from "@ee/licensing/constants";
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
  if (!config.enabled) return;

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
 * The organizations with a license to sync: their own, or the instance-wide
 * one an operator set for the whole deployment.
 */
async function organizationsToSync(prisma: PrismaClient): Promise<string[]> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, license: true },
  });
  return organizations
    .filter((organization) =>
      Boolean(organization.license ?? env.LANGWATCH_LICENSE_KEY),
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
}): Promise<void> {
  const credential = await resolveConnectCredential({ prisma, organizationId });
  if (!credential) return;

  const answer = await client.syncLicense({
    credential,
    version: deps.version ?? readInstallVersion(),
    seats: await countSeats({ repository, organizationId }),
  });

  if (answer.license) {
    await deliverLicense({
      deps,
      prisma,
      client,
      repository,
      organizationId,
      license: answer.license,
    });
    return;
  }

  await recordSuccess({ deps, prisma, organizationId, credential, answer });
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
 * license we did not sign is never stored. The lease that arrived beside it
 * names the license being replaced, so it is not kept: one more sync with the
 * new token is what earns a lease for the new license, and on the LangWatch
 * side it is also what retires the replaced one.
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
}): Promise<void> {
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
    return;
  }

  const renewed = await resolveConnectCredential({ prisma, organizationId });
  if (!renewed) return;

  const again = await client.syncLicense({
    credential: renewed,
    version: deps.version ?? readInstallVersion(),
    seats: await countSeats({ repository, organizationId }),
  });

  await recordSuccess({
    deps,
    prisma,
    organizationId,
    credential: renewed,
    answer: again,
  });
}

/**
 * What a successful sync leaves behind: the time, no failure, and the lease
 * when it is one this install may act on. A lease we did not sign, or one
 * naming another license or another install, is dropped and the previous one
 * stays in effect.
 */
async function recordSuccess({
  deps,
  prisma,
  organizationId,
  credential,
  answer,
}: {
  deps: LicenseSyncDependencies;
  prisma: PrismaClient;
  organizationId: string;
  credential: ConnectCredential;
  answer: { lease: unknown };
}): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { license: true },
  });
  const signedLicense = parseLicenseKey(
    organization?.license ?? env.LANGWATCH_LICENSE_KEY ?? "",
  );
  const verified = signedLicense
    ? verifyLease({
        lease: answer.lease,
        publicKey: deps.publicKey ?? PUBLIC_KEY,
        licenseId: signedLicense.data.licenseId,
        instanceId: credential.instanceId,
      })
    : null;

  await writeSync({
    prisma,
    organizationId,
    now: nowOf(deps),
    data: {
      connectLastSyncError: null,
      ...(verified
        ? { connectLease: answer.lease as Prisma.InputJsonValue }
        : {}),
    },
    touchSyncTime: true,
  });

  logger.info({ organizationId, lease: Boolean(verified) }, "license synced");
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
 * Returns nothing when Connect is off, which is the whole of the offline
 * guarantee here: no client, no credential and no connection for an install
 * that set none of the Connect variables.
 */
export function startLicenseSyncWorker(
  deps: LicenseSyncDependencies = {},
): LicenseSyncWorkerHandle | undefined {
  const config = deps.config ?? readConnectConfig();
  if (!config.enabled) {
    logger.debug("connect is off, skipping the license sync worker");
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
