/**
 * How an organization has set joining, and the four refusals a change passes first — in the
 * order that costs the customer least to fix: the organization's plan, the deployment's
 * licence, the identity provider that already admits people, the domain nobody has proved.
 */
import {
  JoinAutoDomainUnprovenError,
  JoinAutoNotLicensedError,
  JoinPolicyNotLicensedError,
  normalizeDomain,
  type DomainJoinSetting,
  type JoinSettingChange,
} from "@langwatch/identity-contract";

import type { JoinRequestsServiceDeps } from "../rules/join-requests-contract.rules.ts";
import type { JoinRequestAdmissionGuardsService } from "./join-request-admission-guards.service.ts";

export class JoinDomainSettingService {
  static create(
    deps: JoinRequestsServiceDeps,
    guards: JoinRequestAdmissionGuardsService,
  ): JoinDomainSettingService {
    return new JoinDomainSettingService(deps, guards);
  }

  private constructor(
    private readonly deps: JoinRequestsServiceDeps,
    private readonly guards: JoinRequestAdmissionGuardsService,
  ) {}

  /**
   * Turn automatic joining on, off, or back to asking. The plan is asked only of a change that
   * opens the door wider; closing it is free on every plan, and clearing the last domain is
   * closing it.
   */
  async setJoining({
    organizationId,
    domainJoin,
    domains,
    actorUserId,
  }: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    domains: readonly string[];
    actorUserId: string;
  }): Promise<JoinSettingChange> {
    const current = await this.deps.settings.read({ organizationId });
    const normalized = domains.map(normalizeDomain).filter(Boolean);

    if (
      this.opensTheDoorWider({
        from: { domainJoin: current.domainJoin, domains: current.joinDomains },
        to: { domainJoin, domains: normalized },
      }) &&
      !(await this.deps.joinPolicyEntitled({ organizationId }))
    ) {
      throw new JoinPolicyNotLicensedError(
        `organization ${organizationId} asked to set joining to ${domainJoin} on a plan that does not carry the control`,
      );
    }

    if (domainJoin === "auto") {
      if (!(await this.deps.autoJoinLicensed())) {
        throw new JoinAutoNotLicensedError(
          `organization ${organizationId} cannot enable automatic joining without a genuine license`,
        );
      }

      if (normalized.length === 0) {
        throw new JoinAutoDomainUnprovenError(
          "automatic joining needs a company domain to be named",
        );
      }

      for (const domain of normalized) {
        await this.guards.assertDomainProven({ organizationId, domain });
      }
    }

    // Turning automatic joining off clears the domains it named: a setting
    // flipped back on later must name them again, deliberately.
    const nextDomains = domainJoin === "auto" ? normalized : [];
    await this.deps.settings.write({ organizationId, domainJoin, joinDomains: nextDomains });

    const change: JoinSettingChange = {
      previous: current.domainJoin,
      next: domainJoin,
      previousDomains: current.joinDomains,
      nextDomains,
    };
    // Awaited: a setting that decides who may walk in unapproved is the change
    // a customer comes to the audit page for, so the row lands before "saved".
    await this.deps.audit.joiningChanged({ organizationId, actorUserId, change });

    return change;
  }

  /** How this organization has set joining, for the settings card. */
  async readJoining({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ domainJoin: DomainJoinSetting; joinDomains: string[] }> {
    return this.deps.settings.read({ organizationId });
  }

  /**
   * Whether a save lets more people in than the setting already did — asked of the CHANGE:
   * "off" narrows, re-saving changes nothing, another domain on an open door widens it.
   */
  private opensTheDoorWider({
    from,
    to,
  }: {
    from: { domainJoin: DomainJoinSetting; domains: readonly string[] };
    to: { domainJoin: DomainJoinSetting; domains: readonly string[] };
  }): boolean {
    if (to.domainJoin === "off") return false;
    if (to.domainJoin !== from.domainJoin) return true;
    const already = new Set(from.domains);
    return to.domains.some((domain) => !already.has(domain));
  }
}
