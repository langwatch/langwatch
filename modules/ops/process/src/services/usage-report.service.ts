import type {
  ConnectDeploymentView,
  InstanceIdentityView,
  LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import { createLogger } from "@langwatch/observability";
import {
  INSTANCE_ID_NOT_MINTED,
  USAGE_REPORT_EVENT,
  USAGE_REPORT_SCHEMA_VERSION,
  type StartupNoticeState,
  type UsageReportPreview,
  type UsageReportSwitches,
} from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { type Instant, Temporal } from "@langwatch/time";

import type { UsageReportChannel } from "../channels/usage-report.channel.ts";
import { startupNoticeState } from "../rules/startup-notice.rules.ts";
import { nextNoonUtc } from "../rules/usage-report-schedule.rules.ts";
import type { UsageReportCollectionService } from "./usage-report-collection.service.ts";

const logger = createLogger("langwatch:workers:usageStatsWorker");

/** Where the app host has always taken these statistics. */
export const USAGE_REPORT_APP_HOST_URL = "https://app.langwatch.ai/api/track_usage";

/** What the report needs from licensing, which holds the install's identity and Connect state. */
export type UsageReportInstall = Pick<
  LicensingApi,
  | "findInstanceIdentity"
  | "getInstanceId"
  | "getConnectDeployment"
  | "recordUsageReportOutcome"
  | "setUsageReportSwitches"
  | "acknowledgeStartupNotice"
>;

export type UsageReportSendOutcome =
  | "sent"
  | "refused"
  | "unreachable"
  | "switched_off"
  | "connect_disabled"
  | "no_organization";

export interface UsageReportServiceDependencies {
  readonly collection: UsageReportCollectionService;
  readonly organizations: Pick<OrganizationApi, "findAllIds">;
  readonly channel: UsageReportChannel;
  readonly install: UsageReportInstall;
  /** DISABLE_USAGE_STATS. */
  readonly disabled: boolean;
  readonly isSaas: boolean;
  readonly now: () => Instant;
}

/**
 * The daily usage report of a self-hosted install: one report for the whole
 * install, posted to the one host it already talks to, and the answer read
 * and written down so a refused report shows on the checkup page.
 */
export class UsageReportService {
  private constructor(private readonly deps: UsageReportServiceDependencies) {}

  static create(deps: UsageReportServiceDependencies): UsageReportService {
    return new UsageReportService(deps);
  }

  /** The connect host where a license here names a hosted service; the app host otherwise. */
  async getEndpoint(): Promise<string> {
    return endpointFor(await this.deps.install.getConnectDeployment());
  }

  async send(): Promise<UsageReportSendOutcome> {
    const { install, channel } = this.deps;
    if (this.deps.isSaas || this.deps.disabled) return "switched_off";
    const connect = await install.getConnectDeployment();
    // LANGWATCH_CONNECT_DISABLED proves the install calls LangWatch for nothing, this report too.
    if (!connect.permitted) return "connect_disabled";
    const organizationIds = await this.deps.organizations.findAllIds();
    if (organizationIds.length === 0) return "no_organization";

    const instanceId = await install.getInstanceId();
    const [identity] = await install.findInstanceIdentity();
    try {
      const payload = await this.deps.collection.collect({
        organizationIds,
        instanceId,
        firstSeenAt: identity ? Temporal.Instant.from(identity.createdAt) : undefined,
        connected: connect.connected,
        switches: switchesOf(identity),
        now: this.deps.now(),
      });
      const answer = await channel.post({
        endpoint: endpointFor(connect),
        body: { event: USAGE_REPORT_EVENT, ...payload },
      });
      if (answer.status < 200 || answer.status >= 300) {
        // Named by status: the body is whatever the host chose to say.
        logger.warn({ instanceId, status: answer.status }, "usage stats refused");
        await install.recordUsageReportOutcome({ error: `usage_report_refused_${answer.status}` });
        return "refused";
      }
      await install.recordUsageReportOutcome({});
      logger.info({ instanceId }, "usage stats sent");
      return "sent";
    } catch (error) {
      logger.error({ instanceId, error }, "failed to send usage stats");
      await install
        .recordUsageReportOutcome({ error: "usage_report_unreachable" })
        .catch(() => undefined);
      return "unreachable";
    }
  }

  /**
   * The exact report the install would send right now, from the collector the
   * sender calls. The page reads and never mints, so an install that has
   * never reported shows a placeholder identity.
   */
  async preview(): Promise<UsageReportPreview> {
    const now = this.deps.now();
    const [organizationIds, [identity], connect] = await Promise.all([
      this.deps.organizations.findAllIds(),
      this.deps.install.findInstanceIdentity(),
      this.deps.install.getConnectDeployment(),
    ]);
    const switches = switchesOf(identity);
    const payload =
      organizationIds.length === 0
        ? {}
        : await this.deps.collection.collect({
            organizationIds,
            instanceId: identity?.instanceId ?? INSTANCE_ID_NOT_MINTED,
            firstSeenAt: identity ? Temporal.Instant.from(identity.createdAt) : undefined,
            connected: connect.connected,
            switches,
            now,
          });

    return {
      payload: { event: USAGE_REPORT_EVENT, ...payload },
      switches,
      endpoint: endpointFor(connect),
      disabled: this.deps.disabled,
      schemaVersion: USAGE_REPORT_SCHEMA_VERSION,
      nextReportAt: this.deps.disabled
        ? null
        : Temporal.Instant.fromEpochMilliseconds(nextNoonUtc(now.epochMilliseconds)).toString({
            fractionalSecondDigits: 3,
          }),
    };
  }

  /** Changes what the install reports, and answers the report as it now stands. */
  async setSwitches(input: {
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }): Promise<UsageReportPreview> {
    await this.deps.install.setUsageReportSwitches(input);
    return this.preview();
  }

  /** Whether the notice is due. Reads the identity row and never mints it. */
  async getStartupNotice(): Promise<StartupNoticeState> {
    const [identity] = this.deps.isSaas ? [] : await this.deps.install.findInstanceIdentity();
    return startupNoticeState({
      isSaas: this.deps.isSaas,
      usageReportsDisabled: this.deps.disabled,
      acknowledgedSchemaVersion: identity?.startupNoticeAcknowledgedSchemaVersion,
      schemaVersion: USAGE_REPORT_SCHEMA_VERSION,
    });
  }

  /** The dismissal outlives the browser, so it is written to the install's own identity row. */
  async dismissStartupNotice({ schemaVersion }: { schemaVersion: number }): Promise<boolean> {
    if (this.deps.isSaas) return false;
    await this.deps.install.acknowledgeStartupNotice({ schemaVersion });
    return true;
  }
}

function endpointFor(connect: ConnectDeploymentView): string {
  if (!connect.permitted || !connect.connected) return USAGE_REPORT_APP_HOST_URL;
  return `${connect.licenseEndpoint}/v1/stats`;
}

function switchesOf(identity: InstanceIdentityView | undefined): UsageReportSwitches {
  return {
    optional: !identity?.optionalMetricsOptOut,
    hostname: !identity?.hostnameOptOut,
  };
}
