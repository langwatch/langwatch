// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  SeedActionOutcome,
  SeedDemoRunInput,
  SeedRunReport,
} from "@langwatch/enterprise-seed-demo-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { MembersRead } from "@langwatch/process-stores/members";
import type { Instant } from "@langwatch/time";

import { assertDemoOrgAllowed, parseDemoOrgIds } from "../rules/demo-org-scope.rules.ts";
import { verifyOrgIdentity } from "../rules/org-identity.rules.ts";
import { formatReport, reportHasFailures } from "../rules/seed-run-report.rules.ts";

type DemoOrganization = Readonly<{ id: string; name: string; slug: string }>;

type SeedAction = Readonly<{
  name: string;
  run: (
    context: Readonly<{ organization: DemoOrganization; execute: boolean }>,
  ) => Promise<SeedActionOutcome>;
}>;

const ACTIONS: readonly SeedAction[] = [
  { name: "verifyOrgIdentity", run: async ({ organization }) => verifyOrgIdentity(organization) },
];

/** Main's `runSeedDemo`: every action runs against one allowlisted organization, and one failing does not stop the next. */
export class SeedDemoService {
  readonly #organizations: Pick<OrganizationApi, "findProvisioningSummary">;
  readonly #demoOrgIds: string | undefined;
  readonly #logger: MembersRead<["logger"]>["logger"];
  readonly #now: () => Instant;

  private constructor(deps: Parameters<typeof SeedDemoService.create>[0]) {
    this.#organizations = deps.organizations;
    this.#demoOrgIds = deps.demoOrgIds;
    this.#logger = deps.logger;
    this.#now = deps.now;
  }

  static create(deps: {
    organizations: Pick<OrganizationApi, "findProvisioningSummary">;
    demoOrgIds: string | undefined;
    logger: MembersRead<["logger"]>["logger"];
    now: () => Instant;
  }): SeedDemoService {
    return new SeedDemoService(deps);
  }

  async run(input: SeedDemoRunInput): Promise<SeedRunReport> {
    const allowlist = parseDemoOrgIds(this.#demoOrgIds);
    const organizationId = input.organizationId ?? allowlist[0];
    if (organizationId === undefined) {
      throw new Error("No target org id available. The demo allowlist yielded no entries.");
    }
    assertDemoOrgAllowed(organizationId, allowlist);
    const mode = input.execute ? "execute" : "dry-run";
    this.#logger.info({ mode, targetOrgId: organizationId, allowlist }, "starting demo seed run");

    const startedAt = this.#now().toString();
    const organization = await this.#loadOrganization(organizationId);
    const actions: SeedRunReport["actions"] = [];
    for (const action of ACTIONS) {
      const t0 = this.#now().epochMilliseconds;
      let outcome: SeedActionOutcome;
      try {
        outcome = await action.run({ organization, execute: input.execute });
      } catch (error) {
        outcome = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      actions.push({ name: action.name, outcome, durationMs: this.#now().epochMilliseconds - t0 });
    }

    const report: SeedRunReport = {
      startedAt,
      completedAt: this.#now().toString(),
      organizationId: organization.id,
      organizationName: organization.name,
      mode,
      actions,
    };
    this.#logger.info({ report: formatReport(report) }, "demo seed run finished");
    return report;
  }

  /** Main's CronJob ran on the demo instance alone: a deployment with no allowlist seeds nothing. */
  async runScheduled(): Promise<void> {
    if (this.#demoOrgIds === undefined || this.#demoOrgIds.trim() === "") return;
    const report = await this.run({ execute: true });
    if (reportHasFailures(report)) throw new Error("demo seed run had failures");
  }

  async #loadOrganization(organizationId: string): Promise<DemoOrganization> {
    const organization = await this.#organizations.findProvisioningSummary(organizationId);
    if (organization === null) {
      throw new Error(
        `Organization ${JSON.stringify(organizationId)} is in the allowlist but does not exist in the database.`,
      );
    }
    return organization;
  }
}
