/**
 * How an organization has set joining, and the three refusals a change passes first — in the
 * order that costs the customer least to fix: the licence, then the identity provider that
 * already admits people, then the domain nobody has proved.
 */
import {
  DOMAIN_AUTO_JOIN_POLICY_ID,
  JoinAutoDomainUnprovenError,
  JoinAutoNotLicensedError,
  normalizeDomain,
  type DomainJoinSetting,
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
   * Turn automatic joining on, off, or back to asking. Three refusals, in the order that costs the
   * customer least to fix: the licence, then the identity provider that already admits people, then
   * the domain nobody has proved.
   */
  async setJoining({
    organizationId,
    domainJoin,
    domains,
  }: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    domains: readonly string[];
  }): Promise<{ previous: DomainJoinSetting; next: DomainJoinSetting }> {
    const current = await this.deps.settings.read({ organizationId });
    const normalized = domains.map(normalizeDomain).filter(Boolean);

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

    await this.deps.settings.write({
      organizationId,
      domainJoin,
      // Turning automatic joining off clears the domains it named: a setting
      // flipped back on later must name them again, deliberately, rather than
      // inherit a list from a decision somebody made months ago.
      joinDomains: domainJoin === "auto" ? normalized : [],
    });

    return { previous: current.domainJoin, next: domainJoin };
  }

  /** How this organization has set joining, for the settings card. */
  async readJoining({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ domainJoin: DomainJoinSetting; joinDomains: string[] }> {
    return this.deps.settings.read({ organizationId });
  }
}
