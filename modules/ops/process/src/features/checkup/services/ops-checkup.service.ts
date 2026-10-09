import type {
  CheckupResult,
  ExplicitCheckInput,
  OpsServerConfig,
  UsageReportPreview,
} from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import type { CheckupProbeChannel } from "../../../channels/checkup-probe.channel.ts";
import type { UsageReportChannel } from "../../../channels/usage-report.channel.ts";
import type {
  ClickHouseHealthRepository,
  PostgresHealthRepository,
  RedisHealthRepository,
} from "../../../repositories/datastore-health.repository.ts";
import type { UpgradeLedgerRepository } from "../../../repositories/upgrade-ledger.repository.ts";
import { checkupVerdictsOnly } from "../../../rules/checkup-audience.rules.ts";
import { type CheckupFacts } from "../../../rules/checkup-facts.rules.ts";
import type { OpsHealthService } from "../../../services/ops-health.service.ts";
import { UsageReportCollectionService } from "../../../services/usage-report-collection.service.ts";
import {
  UsageReportService,
  type UsageReportSwitchChange,
} from "../../../services/usage-report.service.ts";
import { CheckupService } from "./checkup.service.ts";
import {
  GATEWAY_PROBE_TIMEOUT_MS,
  type OpsCheckupPeers,
  appAddresses,
  canaryFact,
  connectFact,
  licenseView,
  modelProviderFacts,
  probeControlPlane,
  storageFacts,
} from "./ops-checkup-facts.service.ts";

/** The process facts the checkup and the usage report read, drilled in. */
type OpsCheckupFacts = Readonly<{
  isSaas: boolean;
  serviceVersion: string;
  publicBaseUrl: string | undefined;
  nodeEnvironment: string | undefined;
  processRole: string;
}>;

interface OpsCheckupDependencies {
  readonly facts: OpsCheckupFacts;
  readonly config: OpsServerConfig;
  readonly peers: OpsCheckupPeers;
  readonly repositories: {
    readonly postgres: PostgresHealthRepository;
    readonly clickhouse: ClickHouseHealthRepository;
    readonly redis: RedisHealthRepository;
    /** The upgrade ledger both migration rows read, as the Upgrades page reads it. */
    readonly upgradeLedger: Pick<UpgradeLedgerRepository, "findStatus" | "findSteps">;
  };
  readonly channels: { usageReport: UsageReportChannel; probes: CheckupProbeChannel };
  /** The ops health the usage report carries; left out where the process composes none. */
  readonly opsHealth?: Pick<OpsHealthService, "read">;
}

/** Who asks: an install admin reads every detail, anyone else their organization's verdicts. */
type CheckupReader = Readonly<{ organizationId: string; installAdmin: boolean }>;

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
    publicBaseUrl,
  }: {
    gateway: OpsCheckupDependencies["peers"]["gateway"];
    probes: OpsCheckupDependencies["channels"]["probes"];
    publicBaseUrl: string | undefined;
  }): ReturnType<CheckupFacts["gateway"]> {
    const { baseUrl, expectedControlPlaneUrl } = gateway.getDeploymentAddresses();
    return {
      baseUrl,
      controlPlaneUrls: appAddresses([publicBaseUrl, expectedControlPlaneUrl]),
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
    facts,
    config,
    peers,
    repositories,
    channels,
    opsHealth,
  }: OpsCheckupDependencies): OpsCheckupService {
    const collection = UsageReportCollectionService.create({
      peers,
      opsHealth,
      deployment: () => ({
        version: facts.serviceVersion,
        installMethod: config.usageStats.installMethod ?? "self-hosted",
        chartVersion: config.usageStats.chartVersion,
        environment: facts.nodeEnvironment ?? "unknown",
        hostname: facts.publicBaseUrl,
        gatewayConfigured: Boolean(peers.gateway.getDeploymentAddresses().baseUrl),
      }),
    });
    const usageReports = UsageReportService.create({
      collection,
      organizations: peers.organizationDirectory,
      channel: channels.usageReport,
      install: peers.licensing,
      disabled: config.usageStats.disabled,
      isSaas: facts.isSaas,
      now: nowInstant,
    });
    const { postgres, clickhouse, redis, upgradeLedger } = repositories;

    const factsFor = ({
      organizationId,
      requestedBy,
    }: {
      organizationId: string;
      requestedBy: string;
    }): CheckupFacts => ({
      now: nowInstant,
      install: {
        version: facts.serviceVersion,
        processRole: facts.processRole,
        environment: facts.nodeEnvironment ?? "unknown",
      },
      postgres: { ping: () => postgres.findServerVersion() },
      upgrade: {
        status: () => upgradeLedger.findStatus(),
        listSteps: (filter) => upgradeLedger.findSteps(filter),
      },
      clickhouse: {
        // Ops reads the ClickHouse member, so a process that booted it has one.
        configured: true,
        ping: () => clickhouse.ping(),
        findAppFunctionsProvisionable: () => peers.lwql.findAppFunctionsProvisionable(),
      },
      redis: { target: redis.describeTarget(), ready: () => redis.ping() },
      gateway: () =>
        OpsCheckupService.gatewayFacts({
          gateway: peers.gateway,
          probes: channels.probes,
          publicBaseUrl: facts.publicBaseUrl,
        }),
      license: async () => licenseView(await peers.licensing.getLicenseStatus(organizationId)),
      connect: connectFact({ licensing: peers.licensing, organizationId }),
      usageReport: {
        disabled: config.usageStats.disabled,
        findIdentity: () => peers.licensing.findInstanceIdentity(),
        getEndpoint: () => usageReports.getEndpoint(),
      },
      reach: (url) => channels.probes.reach(url),
      storage: storageFacts({ peers, organizationId }),
      email: async () => {
        const view = await peers.mail.getMailDelivery();
        return {
          provider: view.provider,
          smtpConfigured: view.smtpConfigured,
          smtpSendsCredentials: view.smtpSendsCredentials,
          verifySmtp: () => peers.mail.verifySmtp(),
        };
      },
      ...modelProviderFacts({ peers, organizationId, requestedBy }),
      canary: canaryFact({ peers, channels, publicBaseUrl: facts.publicBaseUrl, organizationId }),
    });

    return new OpsCheckupService(facts.isSaas, usageReports, factsFor);
  }

  checkupFor(input: { organizationId: string; requestedBy: string }): CheckupService {
    return CheckupService.create(this.factsFor(input));
  }

  /** The free checks, as this reader may see them (modules/ops/specs/checkup-audience.feature). */
  async cheapFor({
    organizationId,
    installAdmin,
    requestedBy,
  }: CheckupReader & { requestedBy: string }): Promise<CheckupResult> {
    const result = await this.checkupFor({ organizationId, requestedBy }).cheap();
    return installAdmin ? result : checkupVerdictsOnly(result);
  }

  /** The checks that cost egress or money, as this reader may see them. */
  async explicitFor({
    organizationId,
    installAdmin,
    requestedBy,
    ...input
  }: CheckupReader & { requestedBy: string } & ExplicitCheckInput): Promise<CheckupResult> {
    const result = await this.checkupFor({ organizationId, requestedBy }).explicit(input);
    return installAdmin ? result : checkupVerdictsOnly(result);
  }

  /** The whole install's report for an install admin; the organization's own otherwise. */
  usageReportFor({ organizationId, installAdmin }: CheckupReader): Promise<UsageReportPreview> {
    return installAdmin
      ? this.usageReports.preview()
      : this.usageReports.previewForOrganization({ organizationId });
  }

  /** Changes what the install reports; only an install admin reaches it. */
  setUsageReportSwitches(switches: UsageReportSwitchChange): Promise<UsageReportPreview> {
    return this.usageReports.setSwitches(switches);
  }
}
