import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type {
  ConnectStatus,
  LicenseStatus,
  LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type {
  ModelProviderApi,
  ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import type { OpsServerConfig } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type {
  StoredObjectApi,
  StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";

import type { CheckupProbeChannel } from "../channels/checkup-probe.channel.ts";
import type { UsageReportChannel } from "../channels/usage-report.channel.ts";
import type {
  ClickHouseHealthRepository,
  MigrationLedgerRow,
  PostgresHealthRepository,
  RedisHealthRepository,
} from "../repositories/datastore-health.repository.ts";
import {
  type CheckupConnectView,
  type CheckupFacts,
  type CheckupLicenseView,
  CheckupService,
  type ControlPlaneProbe,
  type ProviderTestOutcome,
} from "./checkup.service.ts";
import {
  UsageReportCollectionService,
  type UsageReportPeers,
} from "./usage-report-collection.service.ts";
import { type UsageReportInstall, UsageReportService } from "./usage-report.service.ts";

const CANARY_TIMEOUT_MS = 150_000;
const GATEWAY_PROBE_TIMEOUT_MS = 5_000;

/** The process facts the checkup and the usage report read, drilled in. */
export type OpsCheckupMembers = Readonly<{
  isSaas: boolean;
  serviceVersion: string;
  publicBaseUrl: string | undefined;
  nodeEnvironment: string | undefined;
  processName: string;
}>;

/** Every peer the checkup and the report ask, by the one operation each needs. */
export type OpsCheckupPeers = UsageReportPeers &
  Readonly<{
    organizationDirectory: Pick<OrganizationApi, "findAllIds">;
    licensing: UsageReportInstall & Pick<LicensingApi, "getLicenseStatus" | "getConnectStatus">;
    providerTests: Pick<ModelProviderApi, "listForOrganization" | "testConnection">;
    projectDirectory: Pick<ProjectApi, "listByOrganization">;
    mail: Pick<NotificationApi, "getMailDelivery" | "verifySmtp">;
    storage: Pick<StoredObjectApi, "getStorageDestination" | "probeStorage">;
    lwql: Pick<AnalyticsApi, "findAppFunctionsProvisionable">;
    gateway: Pick<GatewayApi, "getDeploymentAddresses">;
  }>;

export interface OpsCheckupDependencies {
  readonly members: OpsCheckupMembers;
  readonly config: OpsServerConfig;
  readonly peers: OpsCheckupPeers;
  readonly repositories: {
    readonly postgres: PostgresHealthRepository;
    readonly clickhouse: ClickHouseHealthRepository;
    readonly redis: RedisHealthRepository;
  };
  readonly channels: { usageReport: UsageReportChannel; probes: CheckupProbeChannel };
}

/**
 * The checkup of one organization and the install's usage report, each fact
 * wired to the module that owns it (specs/self-hosting/checkup). A fact no
 * installed module answers yet throws, so its row reads "not checked".
 */
export class OpsCheckupService {
  private constructor(
    readonly isSaas: boolean,
    readonly usageReports: UsageReportService,
    private readonly factsFor: (input: {
      organizationId: string;
      requestedBy: string;
    }) => CheckupFacts,
  ) {}

  /** The gateway's addresses, with its health and control-plane reach probed on demand. */
  private static async gatewayFacts({
    gateway,
    probes,
  }: {
    gateway: OpsCheckupDependencies["peers"]["gateway"];
    probes: OpsCheckupDependencies["channels"]["probes"];
  }): ReturnType<CheckupFacts["gateway"]> {
    const { baseUrl, expectedControlPlaneUrl } = gateway.getDeploymentAddresses();
    return {
      baseUrl,
      expectedControlPlaneUrl,
      health: async () => {
        const answer = await probes.get({
          url: `${baseUrl}/healthz`,
          timeoutMs: GATEWAY_PROBE_TIMEOUT_MS,
        });
        if (answer.status < 200 || answer.status >= 300) {
          throw new Error(`answered ${answer.status}`);
        }
      },
      probeControlPlane: () => probeControlPlane({ probes, baseUrl }),
    };
  }

  static create({
    members,
    config,
    peers,
    repositories,
    channels,
  }: OpsCheckupDependencies): OpsCheckupService {
    const collection = UsageReportCollectionService.create({
      peers,
      deployment: () => ({
        version: members.serviceVersion,
        installMethod: config.usageStats.installMethod ?? "self-hosted",
        chartVersion: config.usageStats.chartVersion,
        environment: members.nodeEnvironment ?? "unknown",
        hostname: members.publicBaseUrl,
      }),
    });
    const usageReports = UsageReportService.create({
      collection,
      organizations: peers.organizationDirectory,
      channel: channels.usageReport,
      install: peers.licensing,
      disabled: config.usageStats.disabled,
      isSaas: members.isSaas,
      now: nowInstant,
    });
    const { postgres, clickhouse, redis } = repositories;

    const factsFor = ({
      organizationId,
      requestedBy,
    }: {
      organizationId: string;
      requestedBy: string;
    }): CheckupFacts => ({
      now: nowInstant,
      install: {
        version: members.serviceVersion,
        processRole: members.processName,
        environment: members.nodeEnvironment ?? "unknown",
      },
      postgres: {
        ping: () => postgres.findServerVersion(),
        findMigrationState: async () => {
          const onDisk = await postgres.findReleaseMigrationNames();
          if (onDisk.length === 0) return [];
          return [migrationState({ onDisk, ledger: await postgres.findMigrationLedger() })];
        },
      },
      clickhouse: {
        // Ops reads the ClickHouse member, so a process that booted it has one.
        configured: true,
        ping: () => clickhouse.ping(),
        migrationStatus: () => clickhouse.readMigrationStatus(),
        findAppFunctionsProvisionable: () => peers.lwql.findAppFunctionsProvisionable(),
      },
      redis: { target: redis.describeTarget(), ready: () => redis.ping() },
      gateway: () =>
        OpsCheckupService.gatewayFacts({ gateway: peers.gateway, probes: channels.probes }),
      license: async () => licenseView(await peers.licensing.getLicenseStatus(organizationId)),
      connect: async () => {
        const [status, deployment] = await Promise.all([
          peers.licensing.getConnectStatus({ organizationId }),
          peers.licensing.getConnectDeployment(),
        ]);
        return connectView({
          status,
          hosts: {
            licenseHost: deployment.licenseEndpoint,
            gatewayHost: deployment.gatewayEndpoint,
          },
        });
      },
      usageReport: {
        disabled: config.usageStats.disabled,
        findIdentity: () => peers.licensing.findInstanceIdentity(),
        getEndpoint: () => usageReports.getEndpoint(),
      },
      reach: (url) => channels.probes.reach(url),
      storage: {
        findDestination: async () => {
          const projects = await findOldestProjects({
            projects: peers.projectDirectory,
            organizationId,
          });
          return Promise.all(
            projects.map(async ({ id }) =>
              destinationWords(await peers.storage.getStorageDestination({ projectId: id })),
            ),
          );
        },
        probe: async () => {
          const [project] = await findOldestProjects({
            projects: peers.projectDirectory,
            organizationId,
          });
          if (!project) throw new Error("no project to write for");
          await peers.storage.probeStorage({ projectId: project.id });
        },
      },
      email: async () => {
        const view = await peers.mail.getMailDelivery();
        return {
          provider: view.provider,
          smtpConfigured: view.smtpConfigured,
          verifySmtp: () => peers.mail.verifySmtp(),
        };
      },
      modelProviders: async () =>
        (await peers.providerTests.listForOrganization({ organizationId }))
          .filter((row) => row.enabled)
          .map((row) => ({ id: row.id, provider: row.provider })),
      // The owner's connection test holds the organization's budget itself.
      modelProviderBudget: async () => undefined,
      testModelProvider: async (row) =>
        providerOutcome(
          await peers.providerTests.testConnection(
            { organizationId, modelProviderId: row.id },
            { id: requestedBy },
          ),
        ),
      canary: async (name, params) => {
        const [project] = await findOldestProjects({
          projects: peers.projectDirectory,
          organizationId,
        });
        if (!project) return { status: 412, body: { message: "no project" } };
        const query = new URLSearchParams(params).toString();
        return channels.probes.get({
          url: `${members.publicBaseUrl ?? ""}/api/health/${name}${query ? `?${query}` : ""}`,
          headers: { "X-Auth-Token": project.apiKey, "X-Project-Id": project.id },
          timeoutMs: CANARY_TIMEOUT_MS,
        });
      },
    });

    return new OpsCheckupService(members.isSaas, usageReports, factsFor);
  }

  checkupFor(input: { organizationId: string; requestedBy: string }): CheckupService {
    return CheckupService.create(this.factsFor(input));
  }
}

/** Where the gateway says its control plane is, or why it would not say. */
async function probeControlPlane({
  probes,
  baseUrl,
}: {
  probes: CheckupProbeChannel;
  baseUrl: string | undefined;
}): Promise<ControlPlaneProbe> {
  if (!baseUrl) return { kind: "unreachable", reason: "no gateway" };
  try {
    const answer = await probes.get({
      url: `${baseUrl}/debug/control-plane`,
      timeoutMs: GATEWAY_PROBE_TIMEOUT_MS,
    });
    if (answer.status < 200 || answer.status >= 300) {
      return { kind: "unreachable", reason: `answered ${answer.status}` };
    }
    const named = extractControlPlaneUrl(answer.body);
    return named
      ? { kind: "ok", controlPlaneBaseUrl: named }
      : { kind: "unreachable", reason: "the answer named no control plane" };
  } catch (error) {
    return { kind: "unreachable", reason: error instanceof Error ? error.message : String(error) };
  }
}

function extractControlPlaneUrl(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("control_plane_base_url" in body)) {
    return undefined;
  }
  return typeof body.control_plane_base_url === "string" ? body.control_plane_base_url : undefined;
}

/** The release's migrations the ledger has not finished, and those it started and never did. */
function migrationState({
  onDisk,
  ledger,
}: {
  onDisk: readonly string[];
  ledger: readonly MigrationLedgerRow[];
}): { pending: string[]; failed: string[] } {
  const finished = new Set(ledger.filter((row) => row.finished).map((row) => row.name));
  return {
    pending: onDisk.filter((name) => !finished.has(name)),
    failed: ledger.filter((row) => !row.finished && !row.rolledBack).map((row) => row.name),
  };
}

/** Where stored objects go, in the words the checkup row reads. */
function destinationWords(destination: StoredObjectStorageDestination): string {
  switch (destination.kind) {
    case "s3":
      return `S3 bucket ${destination.bucket}`;
    case "file":
      return `the local path ${destination.root}`;
    case "azure":
      return `Azure container ${destination.container} on ${destination.accountName}`;
  }
}

/** The organization's oldest project, which the canaries run as; empty where it has none. */
async function findOldestProjects({
  projects,
  organizationId,
}: {
  projects: Pick<ProjectApi, "listByOrganization">;
  organizationId: string;
}): Promise<{ id: string; apiKey: string }[]> {
  const page = await projects.listByOrganization({ organizationId, page: 1, limit: 100 });
  return page.data
    .toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .slice(0, 1)
    .map((project) => ({ id: project.id, apiKey: project.apiKey }));
}

function licenseView(status: LicenseStatus): CheckupLicenseView {
  return {
    hasLicense: status.hasLicense,
    valid: status.valid,
    ...("corrupted" in status && status.corrupted !== undefined
      ? { corrupted: status.corrupted }
      : {}),
    ...("expired" in status ? { expired: status.expired } : {}),
    ...("planName" in status ? { planName: status.planName, expiresAt: status.expiresAt } : {}),
    ...("currentMembers" in status
      ? { currentMembers: status.currentMembers, maxMembers: status.maxMembers }
      : {}),
  };
}

function connectView({
  status,
  hosts,
}: {
  status: ConnectStatus;
  hosts: { licenseHost: string; gatewayHost: string };
}): CheckupConnectView {
  if (status.deployment === "off") {
    return { deployment: "off", licensed: false, entitledServices: [], ...hosts };
  }
  return {
    deployment: "on",
    licensed: status.licensed,
    entitledServices: status.entitledServices ?? [...status.enabledServices],
    ...(status.sync.lastSyncAt ? { lastSyncAt: status.sync.lastSyncAt } : {}),
    ...(status.sync.lastError ? { lastSyncError: status.sync.lastError.code } : {}),
    ...hosts,
  };
}

function providerOutcome(verdict: ModelProviderCredentialVerdict): ProviderTestOutcome {
  switch (verdict.outcome) {
    case "verified":
      return { outcome: "verified" };
    case "refused":
      return {
        outcome: "refused",
        code: verdict.domainError.code,
        message: verdict.domainError.code.replace(/_/g, " "),
      };
    default:
      return { outcome: "unchecked", reason: verdict.reason };
  }
}
