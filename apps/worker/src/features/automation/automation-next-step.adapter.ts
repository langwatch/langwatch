/**
 * Where a project's organization can upgrade its automation ceiling. This adapter
 * provides the hop from project to organization and the deployment's checkout address.
 */
import type { AutomationLimitNextStep } from "@langwatch/automation-contract";
import type { PlanProvider, PricingModel } from "@langwatch/entitlement-contract";
import type { PlanNextStepService } from "@langwatch/entitlement-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

/** Where the sales conversation happens for an organization the ladder cannot price. */
const ACCOUNT_TEAM_CONTACT_URL = "https://langwatch.ai/contact";

/**
 * The two organization columns a quote depends on, read where they live.
 *
 * A port rather than the organization repository: what a next step needs of an
 * organization is which ladder it buys from and which currency it is billed in,
 * and a graph that took the whole aggregate to read two columns would couple
 * automation's mail to every future change in it.
 */
export abstract class WorkerAutomationOrganizationPricing {
  abstract pricingFor(input: { organizationId: string }): Promise<{
    pricingModel: PricingModel | null;
    currency: "USD" | "EUR";
  } | null>;
}

export class WorkerAutomationNextStepAdapter {
  static create(options: {
    projects: Pick<ProjectApi, "getOrganizationId">;
    plans: Pick<PlanProvider, "getActivePlan">;
    organizations: WorkerAutomationOrganizationPricing;
    nextStep: PlanNextStepService;
    baseHost: string;
    logger?: Logger;
  }): WorkerAutomationNextStepAdapter {
    return new WorkerAutomationNextStepAdapter(
      options,
      options.logger ?? createLogger("langwatch:automation:next-step"),
    );
  }

  private constructor(
    private readonly options: {
      projects: Pick<ProjectApi, "getOrganizationId">;
      plans: Pick<PlanProvider, "getActivePlan">;
      organizations: WorkerAutomationOrganizationPricing;
      nextStep: PlanNextStepService;
      baseHost: string;
    },
    private readonly logger: Logger,
  ) {}

  /**
   * The rung above this project's organization, or nothing.
   *
   * Nothing rather than a throw on every failure: the notice this decorates is
   * the message telling an administrator their automation has stopped acting,
   * and an unresolvable upgrade line is not a reason to withhold it.
   */
  async resolve(projectId: string): Promise<AutomationLimitNextStep | undefined> {
    try {
      const organizationId = await this.options.projects.getOrganizationId(projectId);
      const pricing = await this.options.organizations.pricingFor({ organizationId });
      if (!pricing) return undefined;

      const plan = await this.options.plans.getActivePlan({ organizationId });
      const resolved = await this.options.nextStep.resolve({
        plan,
        pricingModel: pricing.pricingModel,
        currency: pricing.currency,
      });

      if (resolved.kind === "none") return undefined;
      if (resolved.kind === "account_team") {
        return { kind: "account_team", contactUrl: ACCOUNT_TEAM_CONTACT_URL };
      }

      return {
        kind: "self_serve",
        name: resolved.name,
        url: `${this.options.baseHost}/settings/subscription/checkout/${resolved.tier.toLowerCase()}`,
        price: resolved.monthlyPrice,
        currency: resolved.currency,
        billingPeriod: "monthly",
        pricedPerSeat: resolved.pricedPerSeat,
        dailyCeiling: resolved.automationDailyDispatchCeiling,
      };
    } catch (error) {
      this.logger.warn(
        { projectId, error: error instanceof Error ? error.message : String(error) },
        "Could not resolve the next plan for an automation ceiling notice; the mail names no upgrade",
      );

      return undefined;
    }
  }
}
