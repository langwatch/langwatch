/**
 * Where a self-hosted lead signal goes (ADR-139, section 10).
 *
 * Two places, both of which already existed. Customer.io gets the install's
 * traits on the customer's organization object and one event per signal, so a
 * campaign can be built on either. Slack gets one message per signal, for the
 * person who is going to pick up the phone.
 *
 * Neither is allowed to fail the report that produced the signal, so every call
 * is caught here rather than left to the caller.
 *
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import type { CioEventName, CioOrgTraits } from "@ee/billing/nurturing/types";
import { createLogger } from "@langwatch/observability";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { SelfHostedInstanceRecord } from "../instances/selfHostedInstances";
import type {
  CloudCustomerLookup,
  SelfHostedCrm,
  SignalAnnouncement,
} from "./selfHostedCrm";
import { type SelfHostedSignal, SIGNAL_HEADLINES } from "./selfHostedSignals";

const logger = createLogger("ee:self-hosted-crm");

/** The Customer.io event each signal is tracked as. */
const SIGNAL_EVENTS: Record<SelfHostedSignal, CioEventName> = {
  seats_crossed_threshold: "self_hosted_seats_crossed_threshold",
  sustained_ingestion: "self_hosted_sustained_ingestion",
  licensed_feature_without_license:
    "self_hosted_licensed_feature_without_license",
  license_expiring: "self_hosted_license_expiring",
  domain_has_cloud_account: "self_hosted_domain_has_cloud_account",
};

/** What the nurturing client has to offer. This service needs two of its calls. */
interface NurturingPort {
  groupUser(input: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void>;
  trackEvent(input: {
    userId: string;
    event: CioEventName;
    properties?: Record<string, unknown>;
  }): Promise<void>;
}

/** What the notification service has to offer. */
interface NotificationPort {
  sendSlackSelfHostedSignal(payload: {
    headline: string;
    instanceId: string;
    organizationName?: string | null;
    leadingDomain?: string | null;
    version?: string | null;
    users?: number | null;
    traces28d?: number | null;
    instanceUrl: string;
  }): Promise<void>;
}

function whole(
  report: SelfHostedInstanceRecord["latestReport"],
  key: string,
): number | null {
  const value = report?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The install's traits, as Customer.io holds them on the customer object. */
export function selfHostedOrgTraits(
  instance: SelfHostedInstanceRecord,
): Partial<CioOrgTraits> {
  return {
    self_hosted: true,
    ...(instance.version ? { self_hosted_version: instance.version } : {}),
    ...(instance.installMethod
      ? { self_hosted_install_method: instance.installMethod }
      : {}),
    ...(whole(instance.latestReport, "users") !== null
      ? { self_hosted_users: whole(instance.latestReport, "users") as number }
      : {}),
    ...(whole(instance.latestReport, "projects") !== null
      ? {
          self_hosted_projects: whole(
            instance.latestReport,
            "projects",
          ) as number,
        }
      : {}),
    ...(whole(instance.latestReport, "traces_28d") !== null
      ? {
          self_hosted_traces_28d: whole(
            instance.latestReport,
            "traces_28d",
          ) as number,
        }
      : {}),
    ...(whole(instance.latestReport, "active_users_28d") !== null
      ? {
          self_hosted_active_users_28d: whole(
            instance.latestReport,
            "active_users_28d",
          ) as number,
        }
      : {}),
    self_hosted_first_seen_at: instance.firstSeenAt.toISOString(),
    self_hosted_last_report_at: instance.lastSeenAt.toISOString(),
    self_hosted_signals: instance.raisedSignals.join(","),
  };
}

export class SelfHostedCrmService implements SelfHostedCrm {
  constructor(
    private readonly deps: {
      customers: CloudCustomerLookup;
      notifications: NotificationPort;
      /** Absent on an install with no Customer.io configured. */
      nurturing?: NurturingPort | null;
      baseUrl: string;
    },
  ) {}

  hasAccountOnDomain(domain: string): Promise<boolean> {
    return this.deps.customers.hasAccountOnDomain(domain).catch((error) => {
      captureException(toError(error));
      return false;
    });
  }

  async announce({
    signals,
    instance,
    leadingDomain,
    organizationId,
  }: SignalAnnouncement): Promise<void> {
    if (signals.length === 0) return;

    const customer = organizationId
      ? await this.deps.customers
          .findRepresentative(organizationId)
          .catch(() => null)
      : null;

    await this.toCustomerIo({ signals, instance, customer, organizationId });
    await this.toSlack({
      signals,
      instance,
      leadingDomain,
      organizationName: customer?.organizationName ?? null,
    });
  }

  /**
   * Traits on the customer's organization, and one event per signal.
   *
   * An install with no license is bound to no organization, so there is no
   * object to write traits on and no person to track an event against. Those
   * signals reach Slack alone, which is the right answer: an anonymous install
   * is not a CRM record yet.
   */
  private async toCustomerIo({
    signals,
    instance,
    customer,
    organizationId,
  }: {
    signals: SelfHostedSignal[];
    instance: SelfHostedInstanceRecord;
    customer: { userId: string; organizationName: string } | null;
    organizationId: string | null;
  }): Promise<void> {
    const nurturing = this.deps.nurturing;
    if (!nurturing || !customer || !organizationId) return;

    try {
      await nurturing.groupUser({
        userId: customer.userId,
        groupId: organizationId,
        traits: selfHostedOrgTraits(instance),
      });
      for (const signal of signals) {
        await nurturing.trackEvent({
          userId: customer.userId,
          event: SIGNAL_EVENTS[signal],
          properties: { instance_id: instance.instanceId },
        });
      }
    } catch (error) {
      logger.error({ error }, "failed to push self-hosted traits to the CRM");
      captureException(toError(error));
    }
  }

  private async toSlack({
    signals,
    instance,
    leadingDomain,
    organizationName,
  }: {
    signals: SelfHostedSignal[];
    instance: SelfHostedInstanceRecord;
    leadingDomain: string | null;
    organizationName: string | null;
  }): Promise<void> {
    const instanceUrl = `${this.deps.baseUrl}/ops/backoffice/self-hosted-instances`;
    for (const signal of signals) {
      try {
        await this.deps.notifications.sendSlackSelfHostedSignal({
          headline: SIGNAL_HEADLINES[signal],
          instanceId: instance.instanceId,
          organizationName,
          leadingDomain,
          version: instance.version,
          users: whole(instance.latestReport, "users"),
          traces28d: whole(instance.latestReport, "traces_28d"),
          instanceUrl,
        });
      } catch (error) {
        logger.error({ error, signal }, "failed to post a self-hosted signal");
        captureException(toError(error));
      }
    }
  }
}
