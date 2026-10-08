import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
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
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type {
  StoredObjectApi,
  StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";

import type { CheckupProbeChannel } from "../../../channels/checkup-probe.channel.ts";
import { CANARY_KEY_PERMISSIONS } from "../../../rules/checkup-canary-key.rules.ts";
import {
  type CheckupConnectView,
  type CheckupFacts,
  type CheckupLicenseView,
  type ControlPlaneProbe,
  type ProviderTestOutcome,
} from "../../../rules/checkup-facts.rules.ts";
import { type UsageReportPeers } from "../../../services/usage-report-collection.service.ts";
import { type UsageReportInstall } from "../../../services/usage-report.service.ts";

export const GATEWAY_PROBE_TIMEOUT_MS = 5_000;
const CANARY_TIMEOUT_MS = 150_000;

/** Every peer the checkup and the report ask, by the one operation each needs. */
export type OpsCheckupPeers = UsageReportPeers &
  Readonly<{
    organizationDirectory: Pick<OrganizationApi, "listAllIds">;
    licensing: UsageReportInstall & Pick<LicensingApi, "getLicenseStatus" | "getConnectStatus">;
    providerTests: Pick<ModelProviderApi, "listForOrganization" | "testConnection">;
    projectDirectory: Pick<ProjectApi, "listByOrganization">;
    mail: Pick<NotificationApi, "getMailDelivery" | "verifySmtp">;
    storage: Pick<StoredObjectApi, "getStorageDestination" | "probeStorage">;
    lwql: Pick<AnalyticsApi, "findAppFunctionsProvisionable">;
    gateway: Pick<GatewayApi, "getDeploymentAddresses">;
    /** Mints the minimal system key each canary runs with. */
    apiKeys: Pick<ApiKeyApi, "mintRunKey">;
  }>;

/** The addresses this app is reached at, public first, each once. */

export function storageFacts({
  peers,
  organizationId,
}: {
  peers: OpsCheckupPeers;
  organizationId: string;
}): CheckupFacts["storage"] {
  return {
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
  };
}

export function modelProviderFacts({
  peers,
  organizationId,
  requestedBy,
}: {
  peers: OpsCheckupPeers;
  organizationId: string;
  requestedBy: string;
}): Pick<CheckupFacts, "modelProviders" | "modelProviderBudget" | "testModelProvider"> {
  return {
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
  };
}

export function canaryFact({
  peers,
  channels,
  publicBaseUrl,
  organizationId,
}: {
  peers: OpsCheckupPeers;
  channels: { probes: CheckupProbeChannel };
  publicBaseUrl: string | undefined;
  organizationId: string;
}): CheckupFacts["canary"] {
  return async (name, params) => {
    const [project] = await findOldestProjects({
      projects: peers.projectDirectory,
      organizationId,
    });
    if (!project) return { status: 412, body: { message: "no project" } };
    // A minimal key of the checkup's own, acting as the system: never the project's legacy key.
    const token = await peers.apiKeys.mintRunKey({
      userId: null,
      projectId: project.id,
      permissions: [...CANARY_KEY_PERMISSIONS[name]],
    });
    const query = new URLSearchParams(params).toString();
    return channels.probes.get({
      url: `${publicBaseUrl ?? ""}/api/health/${name}${query ? `?${query}` : ""}`,
      headers: { "X-Auth-Token": token, "X-Project-Id": project.id },
      timeoutMs: CANARY_TIMEOUT_MS,
    });
  };
}

export function connectFact({
  licensing,
  organizationId,
}: {
  licensing: OpsCheckupPeers["licensing"];
  organizationId: string;
}): CheckupFacts["connect"] {
  return async () => {
    const [status, deployment] = await Promise.all([
      licensing.getConnectStatus({ organizationId }),
      licensing.getConnectDeployment(),
    ]);
    return connectView({
      status,
      hosts: {
        licenseHost: deployment.licenseEndpoint,
        gatewayHost: deployment.gatewayEndpoint,
      },
    });
  };
}

export function appAddresses(candidates: (string | undefined)[]): string[] {
  return [
    ...new Set(
      candidates.filter((url): url is string => typeof url === "string" && url.trim() !== ""),
    ),
  ];
}

/** Where the gateway says its control plane is, or why it would not say. */
export async function probeControlPlane({
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

/**
 * The organization's oldest project, which the canaries run as; empty where it has none.
 * Never an aggregate: it receives no traces, so a canary run as one is refused (ADR-175).
 */
async function findOldestProjects({
  projects,
  organizationId,
}: {
  projects: Pick<ProjectApi, "listByOrganization">;
  organizationId: string;
}): Promise<{ id: string }[]> {
  const page = await projects.listByOrganization({
    organizationId,
    page: 1,
    limit: 100,
    includeGovernance: true,
    aggregatesVisibleTo: "nobody",
  });
  return page.data
    .toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .slice(0, 1)
    .map((project) => ({ id: project.id }));
}

export function licenseView(status: LicenseStatus): CheckupLicenseView {
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
