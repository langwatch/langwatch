/**
 * The checkup's dependencies, wired to the modules that already own each
 * fact. Nothing here decides a verdict; that is `checkup.service.ts`. This
 * file is where a probe meets the process, which is why it is the one part of
 * the checkup a unit suite never loads.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { readConnectConfig } from "@ee/licensing/connect/install/connectConfig";
import { ConnectUnreachableError } from "@ee/licensing/connect/install/connectErrors";
import { ConnectSettingsService } from "@ee/licensing/connect/install/connectSettings.service";
import { createConnectDispatcher } from "@ee/licensing/connect/install/connectTransport";
import { readInstanceIdentityRow } from "@ee/licensing/connect/install/instanceIdentity";
import nodemailer from "nodemailer";
import { request } from "undici";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  canProvisionAppFunctions,
  probeAppFunctionStore,
} from "~/server/analytics/lwql/provisioning";
import { getApp } from "~/server/app-layer/app";
import { assertRedisReady } from "~/server/app-layer/redis-readiness";
import { getMigrateStatus } from "~/server/clickhouse/goose";
import { collectUsageStats } from "~/server/collectUsageStats";
import { readInstallVersion } from "~/server/installVersion";
import {
  hasEmailProvider,
  resolveEmailProvider,
} from "~/server/mailer/providers";
import {
  buildSmtpTransportOptions,
  isSmtpConfigured,
} from "~/server/mailer/providers/smtp";
import { assertTestConnectionWithinBudget } from "~/server/modelProviders/modelProvider.service";
import { validateProviderApiKey } from "~/server/modelProviders/providerValidation";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
import { mintUriForDestination } from "~/server/stored-objects/uri";
import { getLicenseHandler } from "~/server/subscriptionHandler";
import { usageStatsEndpoint } from "~/server/usageStatsWorker";
import {
  type CheckupDeps,
  CheckupService,
  type ControlPlaneProbe,
  hostOf,
  portOf,
} from "./checkup.service";
import {
  type UsageReportPreview,
  usageReportPreview,
} from "./usageReportPreview";

const PROBE_TIMEOUT_MS = 5_000;
const CANARY_TIMEOUT_MS = 150_000;

/** The checkup for one organization, on the process's own dependencies. */
export function checkupFor({
  prisma,
  organizationId,
}: {
  prisma: PrismaClient;
  organizationId: string;
}): CheckupService {
  return new CheckupService(realCheckupDeps({ prisma, organizationId }));
}

/** The report this install would send right now, on the sender's own pieces. */
export async function realUsageReportPreview(
  prisma: PrismaClient,
): Promise<UsageReportPreview> {
  return await usageReportPreview({
    prisma,
    disabled: Boolean(env.DISABLE_USAGE_STATS),
    endpoint: () => usageStatsEndpoint(prisma),
    identity: () => readInstanceIdentityRow(prisma),
    collect: (input) => collectUsageStats(input),
  });
}

type CheckupScope = { prisma: PrismaClient; organizationId: string };

/** The organization's oldest project, which the write and canary probes use. */
function firstProjectOf({ prisma, organizationId }: CheckupScope) {
  return async () =>
    await prisma.project.findFirst({
      where: { team: { organizationId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, apiKey: true },
    });
}

function datastoreDeps({
  prisma,
  organizationId,
}: CheckupScope): Pick<CheckupDeps, "postgres" | "clickhouse" | "redis"> {
  const organizationClient = () =>
    getApp().clickhouse.resolveOrganizationClient(organizationId);

  return {
    postgres: {
      ping: async () => {
        const rows = await prisma.$queryRaw<{ server_version: string }[]>`
          -- @tenancy: asks the server its version, which belongs to no tenant.
          SHOW server_version`;
        return rows[0]?.server_version ?? "unknown version";
      },
      migrations: () => pendingPrismaMigrations(prisma),
    },
    clickhouse: {
      configured: Boolean(env.CLICKHOUSE_URL),
      ping: async () => {
        const answer = await (await organizationClient()).ping();
        if (!answer.success) {
          throw answer.error ?? new Error("ping was not successful");
        }
      },
      migrationStatus: () => getMigrateStatus(),
      appFunctionsProvisionable: async () => {
        const client = await organizationClient();
        const probe = await probeAppFunctionStore({
          query: async (sql) => {
            const result = await client.query({
              query: sql,
              format: "JSONEachRow",
            });
            return await result.json<Record<string, string>>();
          },
        });
        return probe === null ? null : canProvisionAppFunctions(probe);
      },
    },
    redis: {
      target: env.REDIS_CLUSTER_ENDPOINTS ?? env.REDIS_URL ?? null,
      ready: () => assertRedisReady(PROBE_TIMEOUT_MS),
    },
  };
}

function gatewayDeps(): Pick<CheckupDeps, "gateway"> {
  const gatewayBaseUrl =
    env.LW_GATEWAY_INTERNAL_URL ?? env.LW_GATEWAY_BASE_URL ?? null;
  return {
    gateway: {
      baseUrl: gatewayBaseUrl,
      expectedControlPlaneUrl:
        process.env.GATEWAY_CONTROL_PLANE_URL ?? env.BASE_HOST ?? null,
      health: async () => {
        const response = await fetch(`${gatewayBaseUrl}/healthz`, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`answered ${response.status}`);
      },
      probeControlPlane: () => probeControlPlane(gatewayBaseUrl),
    },
  };
}

function licensingDeps({
  prisma,
  organizationId,
}: CheckupScope): Pick<CheckupDeps, "license" | "connect" | "identity"> {
  return {
    license: async () => {
      const status = await getLicenseHandler().getLicenseStatus(organizationId);
      return {
        hasLicense: status.hasLicense,
        valid: status.valid,
        ...("corrupted" in status ? { corrupted: status.corrupted } : {}),
        ...("expired" in status ? { expired: status.expired } : {}),
        ...("planName" in status ? { planName: status.planName } : {}),
        ...("expiresAt" in status
          ? { expiresAt: isoOrNull(status.expiresAt) }
          : {}),
        ...("currentMembers" in status
          ? {
              currentMembers: status.currentMembers,
              maxMembers: status.maxMembers,
            }
          : {}),
      };
    },
    connect: async () => {
      const config = readConnectConfig();
      const status = await new ConnectSettingsService({ prisma }).status(
        organizationId,
      );
      const hosts = {
        licenseHost: config.licenseEndpoint,
        gatewayHost: config.gatewayEndpoint,
      };
      if (status.deployment === "off") {
        return {
          deployment: "off",
          licensed: false,
          entitledServices: null,
          lastSyncAt: null,
          lastSyncError: null,
          ...hosts,
        };
      }
      return {
        deployment: "on",
        licensed: status.licensed,
        entitledServices: status.entitledServices ?? status.enabledServices,
        lastSyncAt: status.sync.lastSyncAt,
        lastSyncError: status.sync.lastError?.code ?? null,
        ...hosts,
      };
    },
    identity: () => readInstanceIdentityRow(prisma),
  };
}

function storageDeps(scope: CheckupScope): Pick<CheckupDeps, "storage"> {
  const firstProject = firstProjectOf(scope);
  return {
    storage: {
      destination: async () => {
        const project = await firstProject();
        if (!project) return null;
        const destination = await resolveProjectStorageDestination(project.id);
        switch (destination.kind) {
          case "s3":
            return `S3 bucket ${destination.bucket}`;
          case "file":
            return `the local path ${destination.root}`;
          case "azure":
            return `Azure container ${destination.container} on ${destination.accountName}`;
          default:
            return "an unknown destination";
        }
      },
      probe: async () => {
        const project = await firstProject();
        if (!project) throw new Error("no project to write for");
        const destination = await resolveProjectStorageDestination(project.id);
        const uri = mintUriForDestination({
          destination,
          objectPath: `${project.id}/checkup/${Date.now()}.txt`,
        });
        const registry = createStorageRegistry({ projectId: project.id });
        await registry.put(uri, Buffer.from("checkup"), "text/plain");
        await registry.delete(uri);
      },
    },
  };
}

function modelProviderDeps({
  prisma,
  organizationId,
}: CheckupScope): Pick<
  CheckupDeps,
  "modelProviders" | "modelProviderBudget" | "testModelProvider"
> {
  return {
    modelProviders: async () => {
      const rows = await prisma.modelProvider.findMany({
        where: { organizationId, enabled: true },
        select: { id: true, provider: true, customKeys: true },
      });
      return rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        customKeys: (row.customKeys ?? {}) as Record<string, string>,
      }));
    },
    modelProviderBudget: () => assertTestConnectionWithinBudget(organizationId),
    testModelProvider: async (provider, customKeys) => {
      const result = await validateProviderApiKey(provider, customKeys);
      switch (result.outcome) {
        case "verified":
          return { outcome: "verified" };
        case "refused":
          return {
            outcome: "refused",
            code: result.domainError.code,
            message: result.domainError.code.replace(/_/g, " "),
          };
        default:
          return { outcome: "unchecked", reason: result.reason };
      }
    },
  };
}

function canaryDeps(scope: CheckupScope): Pick<CheckupDeps, "canary"> {
  const firstProject = firstProjectOf(scope);
  return {
    canary: async (name, params) => {
      const project = await firstProject();
      if (!project) return { status: 412, body: { message: "no project" } };
      const query = new URLSearchParams(params).toString();
      const url = `${env.BASE_HOST}/api/health/${name}${query ? `?${query}` : ""}`;
      const response = await fetch(url, {
        headers: { "X-Auth-Token": project.apiKey, "X-Project-Id": project.id },
        signal: AbortSignal.timeout(CANARY_TIMEOUT_MS),
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // A plain-text answer is reported as it came.
      }
      return { status: response.status, body };
    },
  };
}

export function realCheckupDeps(scope: CheckupScope): CheckupDeps {
  const { prisma, organizationId } = scope;
  return {
    organizationId,
    now: () => new Date(),
    install: {
      version: readInstallVersion(),
      processRole: getApp().config.processRole,
      environment: process.env.NODE_ENV ?? "unknown",
    },
    ...datastoreDeps(scope),
    ...gatewayDeps(),
    ...licensingDeps(scope),
    usageReportsDisabled: Boolean(env.DISABLE_USAGE_STATS),
    usageReportEndpoint: () => usageStatsEndpoint(prisma),
    reach: (url) => reach(url),
    ...storageDeps(scope),
    email: {
      provider: emailProviderName(),
      smtpConfigured: isSmtpConfigured(),
      verifySmtp: async () => {
        await nodemailer.createTransport(buildSmtpTransportOptions()).verify();
      },
    },
    ...modelProviderDeps(scope),
    ...canaryDeps(scope),
  };
}

/**
 * The migrations on disk that the database has not finished.
 *
 * Prisma keeps its ledger in `_prisma_migrations`; the folder is what ships
 * with the release. A row that started and never finished is a failed
 * migration, which `migrate deploy` refuses to go past.
 */
async function pendingPrismaMigrations(
  prisma: PrismaClient,
): Promise<{ pending: string[]; failed: string[] } | null> {
  const onDisk = await migrationFolderNames();
  if (onDisk === null) return null;

  const rows = await prisma.$queryRaw<
    {
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }[]
  >`
    -- @tenancy: the migration ledger describes the whole database, not a tenant.
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;

  const finished = new Set(
    rows
      .filter((row) => row.finished_at !== null)
      .map((row) => row.migration_name),
  );
  const failed = rows
    .filter((row) => row.finished_at === null && row.rolled_back_at === null)
    .map((row) => row.migration_name);
  const pending = onDisk.filter((name) => !finished.has(name));
  return { pending, failed };
}

async function migrationFolderNames(): Promise<string[] | null> {
  const candidates = [
    path.join(process.cwd(), "prisma", "migrations"),
    path.join(process.cwd(), "platform", "app", "prisma", "migrations"),
  ];
  for (const folder of candidates) {
    try {
      const entries = await readdir(folder, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function probeControlPlane(
  gatewayBaseUrl: string | null,
): Promise<ControlPlaneProbe> {
  if (!gatewayBaseUrl) return { kind: "unreachable", reason: "no gateway" };
  try {
    const response = await fetch(`${gatewayBaseUrl}/debug/control-plane`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { kind: "unreachable", reason: `answered ${response.status}` };
    }
    const body = (await response.json()) as {
      control_plane_base_url?: unknown;
    };
    if (typeof body.control_plane_base_url !== "string") {
      return {
        kind: "unreachable",
        reason: "the answer named no control plane",
      };
    }
    return { kind: "ok", controlPlaneBaseUrl: body.control_plane_base_url };
  } catch (error) {
    return {
      kind: "unreachable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Any HTTP answer means the host is reachable; the probe asks for nothing the
 * host has to agree to. A transport failure is the one fact an outbound
 * firewall rule needs, so it is named by host and port.
 */
async function reach(url: string): Promise<void> {
  const dispatcher = createConnectDispatcher();
  try {
    const response = await request(url, {
      method: "HEAD",
      dispatcher,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body.dump();
  } catch (error) {
    throw new ConnectUnreachableError({
      host: hostOf(url),
      port: portOf(url),
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

function emailProviderName(): string | null {
  if (!hasEmailProvider()) return null;
  try {
    return resolveEmailProvider()?.name ?? null;
  } catch {
    return null;
  }
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}
