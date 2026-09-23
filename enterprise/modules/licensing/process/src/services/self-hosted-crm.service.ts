/**
 * Where a self-hosted lead signal goes (ADR-156, section 10): traits and one
 * event per signal on the customer's CRM object, and one Slack message per
 * signal. Neither may fail the report that raised it.
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import type { SelfHostedSignal } from "@langwatch/enterprise-licensing-contract";

import type {
  CloudCustomerLookup,
  SelfHostedLeadNotifications,
  SelfHostedLeadNurturing,
  SelfHostedOrgTraits,
  LicenseLogger,
} from "../app/licensing.members.ts";
import type { SelfHostedInstanceRecord } from "../repositories/self-hosted-instance.repository.ts";
import { isReportNumber } from "../rules/self-hosted-report.rules.ts";
import { SIGNAL_EVENTS, SIGNAL_HEADLINES } from "../rules/self-hosted-signals.rules.ts";

export type SignalAnnouncement = Readonly<{
  signals: readonly SelfHostedSignal[];
  instance: SelfHostedInstanceRecord;
  leadingDomain: string | undefined;
  organizationId: string | null;
}>;

export type SelfHostedCrmCollaborators = Readonly<{
  customers: CloudCustomerLookup;
  notifications: SelfHostedLeadNotifications;
  /** Absent where no CRM is configured. */
  nurturing?: SelfHostedLeadNurturing;
  /** Where the backoffice lives, for the link in the Slack message. */
  baseUrl: string;
  logger?: LicenseLogger;
}>;

/** The counts a report carried under these keys; a key it did not carry is left out. */
function reportedCounts(
  instance: SelfHostedInstanceRecord,
  keys: Readonly<Record<string, string>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(keys).flatMap(([name, key]) => {
      const value = instance.latestReport?.[key];
      return isReportNumber(value) ? [[name, value]] : [];
    }),
  );
}

/** The install's traits, as the CRM holds them on the customer's object. */
function selfHostedOrgTraits(instance: SelfHostedInstanceRecord): SelfHostedOrgTraits {
  return {
    self_hosted: true,
    ...(instance.version ? { self_hosted_version: instance.version } : {}),
    ...(instance.installMethod ? { self_hosted_install_method: instance.installMethod } : {}),
    ...reportedCounts(instance, {
      self_hosted_users: "users",
      self_hosted_projects: "projects",
      self_hosted_traces_28d: "traces_28d",
      self_hosted_active_users_28d: "active_users_28d",
    }),
    self_hosted_first_seen_at: instance.firstSeenAt.toString(),
    self_hosted_last_report_at: instance.lastSeenAt.toString(),
    self_hosted_signals: instance.raisedSignals.join(","),
  };
}

export class SelfHostedCrmService {
  static create(collaborators: SelfHostedCrmCollaborators): SelfHostedCrmService {
    return new SelfHostedCrmService(collaborators);
  }

  private constructor(private readonly collaborators: SelfHostedCrmCollaborators) {}

  /** A failed lookup answers false: a report is never refused over a CRM question. */
  async hasAccountOnDomain(domain: string): Promise<boolean> {
    try {
      return await this.collaborators.customers.hasAccountOnDomain(domain);
    } catch (error) {
      this.collaborators.logger?.error({ error }, "self-hosted domain lookup failed");
      return false;
    }
  }

  async announce({
    signals,
    instance,
    leadingDomain,
    organizationId,
  }: SignalAnnouncement): Promise<void> {
    if (signals.length === 0) return;
    const [customer] = organizationId
      ? await this.collaborators.customers.findRepresentatives(organizationId).catch(() => [])
      : [];
    await this.toCrm({ signals, instance, customer, organizationId });
    await this.toSlack({
      signals,
      instance,
      leadingDomain,
      organizationName: customer?.organizationName ?? null,
    });
  }

  /** An install bound to no organization is not a CRM record yet: it reaches Slack alone. */
  private async toCrm({
    signals,
    instance,
    customer,
    organizationId,
  }: {
    signals: readonly SelfHostedSignal[];
    instance: SelfHostedInstanceRecord;
    customer: { userId: string } | undefined;
    organizationId: string | null;
  }): Promise<void> {
    const nurturing = this.collaborators.nurturing;
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
      this.collaborators.logger?.error({ error }, "failed to push self-hosted traits to the CRM");
    }
  }

  private async toSlack({
    signals,
    instance,
    leadingDomain,
    organizationName,
  }: {
    signals: readonly SelfHostedSignal[];
    instance: SelfHostedInstanceRecord;
    leadingDomain: string | undefined;
    organizationName: string | null;
  }): Promise<void> {
    const instanceUrl = `${this.collaborators.baseUrl}/ops/backoffice/self-hosted-instances`;
    const counts = reportedCounts(instance, { users: "users", traces28d: "traces_28d" });
    for (const signal of signals) {
      try {
        await this.collaborators.notifications.sendSlackSelfHostedSignal({
          headline: SIGNAL_HEADLINES[signal],
          instanceId: instance.instanceId,
          organizationName,
          leadingDomain: leadingDomain ?? null,
          version: instance.version,
          users: counts.users ?? null,
          traces28d: counts.traces28d ?? null,
          instanceUrl,
        });
      } catch (error) {
        this.collaborators.logger?.error({ error, signal }, "failed to post a self-hosted signal");
      }
    }
  }
}
