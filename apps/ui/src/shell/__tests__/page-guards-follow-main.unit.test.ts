/**
 * Main's page guards, one row per page (withPermissionGuard / withFeatureFlagGuard
 * on origin/main), read against what the installed modules now declare.
 * specs/ui/page-permission-guards.feature
 */
import { webModules } from "@langwatch/installed-web-modules";
import type { WebScreen } from "@langwatch/browser";
import { resolveUiPageAccess } from "@langwatch/browser/page-guard";
import { describe, expect, it } from "vitest";

const GOVERNANCE_FLAG = "release_ui_ai_governance_enabled";

type MainGuard = { page: string; permission?: string; flags?: readonly string[] };

const MAIN_GUARDS: readonly MainGuard[] = [
  { page: "pages/[project]/traces", permission: "traces:view" },
  { page: "pages/[project]/analytics/index", permission: "analytics:view" },
  { page: "pages/[project]/analytics/evaluations", permission: "analytics:view" },
  { page: "pages/[project]/analytics/metrics", permission: "analytics:view" },
  { page: "pages/[project]/analytics/reports", permission: "analytics:view" },
  { page: "pages/[project]/analytics/topics", permission: "analytics:view" },
  { page: "pages/[project]/analytics/users", permission: "analytics:view" },
  { page: "pages/[project]/analytics/custom/index", permission: "analytics:view" },
  { page: "pages/[project]/analytics/custom/[id]", permission: "analytics:view" },
  { page: "pages/[project]/setup", permission: "project:view" },
  { page: "pages/[project]/evaluators", permission: "evaluations:view" },
  { page: "pages/[project]/online-evaluations", permission: "evaluations:view" },
  { page: "pages/[project]/experiments/index", permission: "experiments:view" },
  { page: "pages/[project]/annotations", permission: "annotations:view" },
  { page: "pages/settings/annotation-scores", permission: "annotations:view" },
  { page: "runtime/ui/features/agent-ui-host.adapter", permission: "evaluations:view" },
  { page: "pages/[project]/automations", permission: "triggers:view" },
  { page: "pages/[project]/automations/activity", permission: "triggers:view" },
  { page: "pages/[project]/automations/alerts", permission: "triggers:view" },
  { page: "pages/[project]/automations/automations", permission: "triggers:view" },
  { page: "pages/[project]/automations/schedules", permission: "triggers:view" },
  { page: "pages/[project]/simulations/[[...path]]", permission: "scenarios:view" },
  { page: "pages/[project]/simulations/scenarios/index", permission: "scenarios:view" },
  { page: "pages/[project]/datasets", permission: "datasets:view" },
  { page: "pages/[project]/prompts", permission: "prompts:view" },
  { page: "pages/[project]/workflows", permission: "workflows:view" },
  { page: "pages/[project]/sessions", flags: [GOVERNANCE_FLAG] },
  { page: "pages/[project]/pull-requests", flags: [GOVERNANCE_FLAG] },
  { page: "pages/me/index", flags: [GOVERNANCE_FLAG] },
  { page: "pages/me/configure", flags: [GOVERNANCE_FLAG] },
  { page: "pages/me/pull-requests", flags: [GOVERNANCE_FLAG] },
  { page: "pages/me/sessions", flags: [GOVERNANCE_FLAG] },
  { page: "pages/me/budget/request", flags: [GOVERNANCE_FLAG] },
  { page: "pages/settings", permission: "organization:view" },
  { page: "pages/settings/roles", permission: "organization:manage" },
  { page: "pages/settings/audit-log", permission: "organization:manage" },
  { page: "pages/settings/authentication", permission: "sso:view" },
  { page: "pages/settings/authentication/provider", permission: "sso:view" },
  { page: "pages/settings/authentication/connectors", permission: "sso:view" },
  { page: "pages/settings/teams/[team]", permission: "team:view" },
  { page: "pages/settings/data-privacy", permission: "project:view" },
  { page: "pages/settings/data-retention", permission: "project:view" },
  { page: "pages/settings/email-suppressions", permission: "triggers:view" },
  { page: "pages/settings/integrations", permission: "organization:manage" },
  { page: "pages/settings/plans", permission: "organization:view" },
  { page: "pages/settings/usage", permission: "cost:view" },
  { page: "pages/settings/topic-clustering", permission: "project:manage" },
  { page: "pages/gateway/virtual-keys", permission: "virtualKeys:view" },
  { page: "pages/gateway/virtual-keys/[id]", permission: "virtualKeys:view" },
  { page: "pages/gateway/budgets", permission: "gatewayBudgets:view" },
  { page: "pages/gateway/budgets/[id]", permission: "gatewayBudgets:view" },
  {
    page: "pages/gateway/routing-policies",
    permission: "routingPolicies:view",
    flags: [GOVERNANCE_FLAG],
  },
  { page: "pages/gateway/usage", permission: "gatewayUsage:view" },
  { page: "pages/gateway/billing-events", permission: "gatewayUsage:view" },
  { page: "pages/gateway/cache-rules", permission: "gatewayCacheRules:view" },
  { page: "pages/gateway/guardrails", permission: "gatewayGuardrails:view" },
];

const declared: Record<string, WebScreen> = Object.fromEntries(
  webModules.flatMap((module) => Object.entries(module.installation.screens)),
);

function accessFor({
  page,
  grants,
  flagsOn,
}: {
  page: string;
  grants: readonly string[];
  flagsOn: boolean;
}) {
  const screen = declared[page];
  return resolveUiPageAccess({
    ...(screen?.requires === void 0 ? {} : { permission: screen.requires }),
    ...(screen?.flags === void 0
      ? {}
      : { flags: screen.flags.map((flag) => (typeof flag === "string" ? flag : flag.name)) }),
    featureFlag: () => flagsOn,
    hasPermission: (needed) => grants.includes(needed),
    isSettled: () => true,
  });
}

const granted = MAIN_GUARDS.filter((row) => row.permission !== void 0);
const flagged = MAIN_GUARDS.filter((row) => row.flags !== void 0);

describe("given the pages main guarded", () => {
  /** @scenario "Every page main guarded declares main's grant and flags" */
  it.each(MAIN_GUARDS)("$page declares main's grant and flags", ({ page, permission, flags }) => {
    expect(declared[page]?.requires).toBe(permission);
    expect(declared[page]?.flags).toEqual(flags);
  });

  /** @scenario "A reader without a page's grant is refused and told the grant" */
  it.each(granted)("$page refuses a reader without $permission", ({ page, permission }) => {
    expect(accessFor({ page, grants: [], flagsOn: true })).toEqual({
      kind: "forbidden",
      permission,
    });
  });

  /** @scenario "A reader holding a page's grant opens it" */
  it.each(granted)("$page opens for a reader holding $permission", ({ page, permission }) => {
    const grants = permission === void 0 ? [] : [permission];
    expect(accessFor({ page, grants, flagsOn: true })).toEqual({ kind: "open" });
  });

  /** @scenario "A page behind a release flag that is off does not exist" */
  it.each(flagged)("$page is not found while its flag is off", ({ page, permission }) => {
    const grants = permission === void 0 ? [] : [permission];
    expect(accessFor({ page, grants, flagsOn: false })).toEqual({ kind: "not-found" });
  });

  describe("when a module's own spec names the guard", () => {
    /** What a neighbouring grant and the page's own grant each get, per page. */
    const accessWithAndWithout = ({
      pages,
      permission,
    }: {
      pages: readonly string[];
      permission: string;
    }) =>
      pages.map((page) => ({
        without: accessFor({ page, grants: ["traces:view"], flagsOn: true }),
        with: accessFor({ page, grants: [permission], flagsOn: true }),
      }));
    const refusedThenOpened = ({ count, permission }: { count: number; permission: string }) =>
      Array.from({ length: count }, () => ({
        without: { kind: "forbidden", permission },
        with: { kind: "open" },
      }));
    const ANALYTICS = MAIN_GUARDS.filter((row) => row.page.includes("/analytics/"));

    /** @scenario "The agents page is behind the grant its platform page asked for" */
    it("refuses the agents page to a reader holding a neighbouring grant", () => {
      const pages = ["runtime/ui/features/agent-ui-host.adapter"];
      expect(accessWithAndWithout({ pages, permission: "evaluations:view" })).toEqual(
        refusedThenOpened({ count: pages.length, permission: "evaluations:view" }),
      );
    });

    /** @scenario "Every analytics address is behind the analytics view grant" */
    it("opens every analytics address on analytics:view", () => {
      for (const { page } of ANALYTICS) {
        expect(accessFor({ page, grants: ["analytics:view"], flagsOn: true })).toEqual({
          kind: "open",
        });
      }
    });

    /** @scenario "A reader without the analytics grant reaches no analytics page" */
    it("refuses every analytics address without analytics:view", () => {
      const pages = ANALYTICS.map((row) => row.page);
      expect(accessWithAndWithout({ pages, permission: "analytics:view" })).toEqual(
        refusedThenOpened({ count: pages.length, permission: "analytics:view" }),
      );
    });

    /** @scenario "feature flag off hides the whole portal" */
    it("answers /me with not-found, never the portal, while the governance flag is off", () => {
      expect(accessFor({ page: "pages/me/index", grants: [], flagsOn: false })).toEqual({
        kind: "not-found",
      });
    });

    /** @scenario "Reading the evaluator library needs the evaluations view grant" */
    it("opens the evaluators page on evaluations:view", () => {
      const access = accessFor({
        page: "pages/[project]/evaluators",
        grants: ["evaluations:view"],
        flagsOn: true,
      });
      expect(access).toEqual({ kind: "open" });
    });

    /** @scenario "A reader without the evaluations view grant reaches no evaluator page" */
    it("refuses the evaluators page without evaluations:view", () => {
      const pages = ["pages/[project]/evaluators"];
      expect(accessWithAndWithout({ pages, permission: "evaluations:view" })).toEqual(
        refusedThenOpened({ count: pages.length, permission: "evaluations:view" }),
      );
    });

    /** @scenario "Reading the online evaluations needs the evaluations view grant" */
    it("opens the online evaluations page on evaluations:view", () => {
      const access = accessFor({
        page: "pages/[project]/online-evaluations",
        grants: ["evaluations:view"],
        flagsOn: true,
      });
      expect(access).toEqual({ kind: "open" });
    });

    /** @scenario "A reader without the evaluations view grant reaches no online evaluation page" */
    it("refuses the online evaluations page without evaluations:view", () => {
      const pages = ["pages/[project]/online-evaluations"];
      expect(accessWithAndWithout({ pages, permission: "evaluations:view" })).toEqual(
        refusedThenOpened({ count: pages.length, permission: "evaluations:view" }),
      );
    });
  });
});
