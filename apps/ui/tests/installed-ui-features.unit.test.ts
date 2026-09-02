/**
 * What this package installs for itself, and how a host's install meets it.
 *
 * The governance move made `apps/ui` a package that serves pages, and this is
 * the seam that made that possible without editing the host: the loaders and
 * the feature transports are declared here, merged under whatever the composing
 * application passes.
 */

import { describe, expect, it } from "vitest";
import { UiFeedbackPort, UiSessionPort } from "../src/behavior/ui-capabilities";
import { installedUiFeatures, mergeUiFeatureInstalls } from "../src/features/installed-ui-features";

const AGENT_PAGE_KEYS = [
  // ONE key for ONE screen, and it still names the platform adapter that used
  // to serve it. The route transcript is the parity bar for the URL surface and
  // fails on any page-key change, so the key was left alone rather than spent
  // on a cosmetic rename — several other families' keys name platform modules
  // that no longer exist either.
  "runtime/ui/features/agent-ui-host.adapter",
];

const ANALYTICS_PAGE_KEYS = [
  // NINE keys for EIGHT screens. Seven addresses are their own screen; the
  // chart builder serves two and is told which by a `mode` prop, the
  // automations tab-as-prop shape applied to a form. All nine carry the same
  // grant — every one of the platform page files was
  // `withPermissionGuard("analytics:view")` — and
  // `analytics-page-policy.integration.test.tsx` asserts that in both
  // directions, key by key.
  "pages/[project]/analytics/index",
  "pages/[project]/analytics/users",
  "pages/[project]/analytics/topics",
  "pages/[project]/analytics/metrics",
  "pages/[project]/analytics/evaluations",
  "pages/[project]/analytics/reports",
  "pages/[project]/analytics/query",
  "pages/[project]/analytics/custom/index",
  "pages/[project]/analytics/custom/[id]",
];

const ANNOTATION_PAGE_KEYS = [
  // FOUR keys for ONE screen, the automations shape applied to a list: the
  // four addresses were four page files that differed only in the props they
  // handed one table, so the feature maps each key to the VIEW it shows and the
  // screen is told rather than reading the address.
  //
  // The fifth annotations address, `/annotations/my-queue`, is deliberately
  // absent: the queue walker mounts the trace family's conversation view, which
  // no package publishes, so `platform/app` still serves that key.
  "pages/[project]/annotations",
  "pages/[project]/annotations/me",
  "pages/[project]/annotations/all",
  "pages/[project]/annotations/[slug]",
];

const API_KEY_PAGE_KEYS = [
  // Two keys, one package, one frontend feature — and they had to ship
  // together: `/cli/auth` imports the permission ceiling and the category
  // picker Settings > API Keys owns, so moving one without the other would have
  // left the CLI screen importing files the settings move deletes. Neither
  // carries a page-level grant; `api-key-page-policy.integration.test.tsx`
  // asserts that in both directions.
  "pages/settings/api-keys",
  "pages/cli/auth",
];

const SECRET_PAGE_KEYS = [
  // One key, its own package. `secrets.*` is `@langwatch/secret-server`'s
  // transport and every type on the page is `@langwatch/secret-contract`'s, so
  // the data-governance family's rule — a key belongs to the family that owns
  // its transport — puts it here rather than in the API key package it moved
  // alongside.
  "pages/settings/secrets",
];

const AUTHZ_PAGE_KEYS = [
  // Two settings keys, one package, one frontend feature. BOTH carry a
  // page-level grant — `organization:manage` — because both pages read
  // audit-grade RBAC data: who holds which role, and where.
  "pages/settings/roles",
  "pages/settings/role-bindings",
];

const AUTOMATION_PAGE_KEYS = [
  // Five keys for ONE screen: the four tabs are four URLs of the same page, and
  // `/activity` is a fifth address that has shown the overview since the
  // History tab was folded into it. The feature maps each key to the tab it
  // shows, which is why the screen never reads the pathname.
  "pages/[project]/automations",
  "pages/[project]/automations/automations",
  "pages/[project]/automations/alerts",
  "pages/[project]/automations/schedules",
  "pages/[project]/automations/activity",
];

const DATA_GOVERNANCE_PAGE_KEYS = [
  // Two settings keys, two packages, two frontend features. They travel
  // together because they are one family to a reader — what LangWatch keeps and
  // who may read it — and separately in the source because the two features
  // already owned a package each.
  "pages/settings/data-retention",
  "pages/settings/data-privacy",
];

const DATASET_PAGE_KEYS = [
  // Two keys, two screens, and their policies differ: the list page carried
  // `datasets:view` and the detail page carried no guard at all, which is what
  // a deep link into one dataset has always done.
  "pages/[project]/datasets",
  "pages/[project]/datasets/[id]",
];

const EVALUATOR_PAGE_KEYS = [
  // One key, one screen. The three overlays it opens — the evaluator editor,
  // the code evaluator editor and the category picker — stay registered in
  // `platform/app`, because between them they have thirteen openers outside
  // this family.
  "pages/[project]/evaluators",
];

const MONITOR_PAGE_KEYS = [
  // One key, one screen, and the same recorded overlay gap: creating an online
  // evaluation, editing one and setting up a guardrail are all `platform/app`
  // drawers with openers outside this family.
  "pages/[project]/online-evaluations",
];

const MODEL_PROVIDER_PAGE_KEYS = [
  // Two settings keys, one package, one frontend feature. NEITHER CARRIES A
  // PAGE-LEVEL GRANT: both platform pages framed themselves in `SettingsLayout`
  // and nothing else, and both read `project:manage` inside the page to decide
  // whether the write controls are live.
  "pages/settings/model-providers",
  "pages/settings/model-costs",
];

const GATEWAY_PAGE_KEYS = [
  "pages/gateway/virtual-keys",
  "pages/gateway/virtual-keys/[id]",
  "pages/gateway/budgets",
  "pages/gateway/budgets/[id]",
  "pages/gateway/routing-policies",
  "pages/gateway/usage",
  "pages/gateway/cache-rules",
  "pages/gateway/guardrails",
  "pages/gateway/billing-events",
  "pages/gateway/webhooks",
];

const ORGANIZATION_PAGE_KEYS = [
  // One key, its own package, and its own new one. `organization.getAuditLogs`
  // is `@langwatch/organization-server`'s transport and `EnrichedAuditLog` is
  // `@langwatch/organization-contract`'s, so the credentials family's rule —
  // a key belongs to the family that owns its transport — puts it here.
  "pages/settings/audit-log",
];

const PERSONAL_WORKSPACE_PAGE_KEYS = [
  // The one key in this family that is not a `/me/*` page. Every tRPC call on
  // Settings > Authentication is `user.*`, and the account's own credentials
  // are what this package is for.
  "pages/settings/authentication",
  "pages/me/index",
  "pages/me/configure",
  "pages/me/sessions",
  "pages/me/pull-requests",
  "pages/me/budget/request",
  // Two project-scoped keys, and they belong to this family because their
  // whole page bodies were its tables. They are children of a layout route the
  // host still serves, which the merge point makes possible.
  "pages/[project]/sessions",
  "pages/[project]/pull-requests",
];

const PROMPT_PAGE_KEYS = [
  // One key, one screen. `prompts:view` travelled with it; the
  // `layoutComponent: DashboardLayout` half of the platform guard's call did
  // not — chrome belongs to the route tree.
  "pages/[project]/prompts",
];

const OPS_PAGE_KEYS = [
  "pages/ops/index",
  "pages/ops/dejaview",
  "pages/ops/event-sourcing/index",
  "pages/ops/event-sourcing/dead-letters",
  "pages/ops/event-sourcing/processes",
  "pages/ops/event-sourcing/projections",
  "pages/ops/event-sourcing/subscribers",
  "pages/ops/event-sourcing/schedules",
  "pages/ops/blobs",
  "pages/ops/feature-flags",
  "pages/ops/foundry",
  "pages/ops/migrations",
  "pages/ops/projections/[runId]",
  // Six keys for ONE screen, the automations shape again: the Backoffice's six
  // resources were six three-line page files around one admin-gated shell, so
  // the feature maps each key to the resource it shows and the screen is told
  // rather than reading the address.
  "pages/ops/backoffice/bug-reports",
  "pages/ops/backoffice/users",
  "pages/ops/backoffice/organizations",
  "pages/ops/backoffice/projects",
  "pages/ops/backoffice/subscriptions",
  "pages/ops/backoffice/sso-connections",
];

const GOVERNANCE_PAGE_KEYS = [
  "pages/governance/index",
  "pages/governance/inventory.enterprise",
  "pages/governance/ingestion-source-detail.enterprise",
  "pages/governance/anomaly-rules.enterprise",
  "pages/governance/people",
  "pages/governance/costs",
  "pages/governance/billed",
  "pages/governance/teams",
  "pages/governance/teams/[id]",
  "pages/governance/users",
  "pages/governance/users/[id]",
];

class RecordingFeedback extends UiFeedbackPort {
  succeeded(): void {}
  failed(): void {}
}

class RecordingSession extends UiSessionPort {
  currentUser() {
    return null;
  }
  activeScope() {
    return { organizationId: null, projectId: null };
  }
  hasPermission() {
    return false;
  }
  isSettled() {
    return true;
  }
  featureFlag() {
    return false;
  }
}

describe("given what apps/ui serves itself", () => {
  describe("when the standing declaration is read", () => {
    it("registers a loader for every page key the families it serves name", () => {
      expect(Object.keys(installedUiFeatures.loaders ?? {}).sort()).toEqual(
        [
          ...AGENT_PAGE_KEYS,
          ...ANALYTICS_PAGE_KEYS,
          ...ANNOTATION_PAGE_KEYS,
          ...API_KEY_PAGE_KEYS,
          ...AUTHZ_PAGE_KEYS,
          ...AUTOMATION_PAGE_KEYS,
          ...DATA_GOVERNANCE_PAGE_KEYS,
          ...DATASET_PAGE_KEYS,
          ...EVALUATOR_PAGE_KEYS,
          ...GATEWAY_PAGE_KEYS,
          ...GOVERNANCE_PAGE_KEYS,
          ...MODEL_PROVIDER_PAGE_KEYS,
          ...MONITOR_PAGE_KEYS,
          ...OPS_PAGE_KEYS,
          ...ORGANIZATION_PAGE_KEYS,
          ...PROMPT_PAGE_KEYS,
          ...SECRET_PAGE_KEYS,
          ...PERSONAL_WORKSPACE_PAGE_KEYS,
        ].sort(),
      );
    });

    it("mounts each feature's own transport Provider", () => {
      // Twenty for nineteen features: the personal workspace mounts two,
      // because the coding-agent tables its screens render call procedures of
      // their own and `apps/ui` may not import the package they live in.
      expect(installedUiFeatures.apis?.map((api) => api.name)).toEqual([
        "@langwatch/agent-web",
        "@langwatch/analytics-web",
        "@langwatch/annotation-web",
        "@langwatch/api-key-web",
        "@langwatch/authz-web",
        "@langwatch/automation-web",
        "@langwatch/data-privacy-web",
        "@langwatch/data-retention-web",
        "@langwatch/dataset-web",
        "@langwatch/evaluator-web",
        "@langwatch/gateway-web",
        "@langwatch/enterprise-governance-web",
        "@langwatch/model-provider-web",
        "@langwatch/monitor-web",
        "@langwatch/ops-web",
        "@langwatch/organization-web",
        "@langwatch/prompt-web",
        "@langwatch/secret-web",
        "@langwatch/user-web",
        "@langwatch/coding-agent-web",
      ]);
    });

    it("answers the feedback capability rather than leaving the refusing default", () => {
      expect(installedUiFeatures.capabilities?.feedback).toBeInstanceOf(UiFeedbackPort);
    });

    it("reads the deployment's own session", () => {
      expect(installedUiFeatures.session).toBeTypeOf("function");
    });
  });

  describe("when a host brings an install of its own", () => {
    it("adds the host's loaders without dropping this package's", () => {
      const merged = mergeUiFeatureInstalls(installedUiFeatures, {
        loaders: { "pages/host/only": () => Promise.resolve({ default: () => null }) },
      });

      expect(Object.keys(merged.loaders ?? {})).toContain("pages/host/only");
      expect(Object.keys(merged.loaders ?? {})).toContain("pages/governance/index");
    });

    it("lets the host's capability win over this package's", () => {
      const hostFeedback = new RecordingFeedback();

      const merged = mergeUiFeatureInstalls(installedUiFeatures, {
        capabilities: { feedback: hostFeedback },
      });

      expect(merged.capabilities?.feedback).toBe(hostFeedback);
    });

    it("lets the host's session source win over this package's", () => {
      const hostSession = () => new RecordingSession();

      const merged = mergeUiFeatureInstalls(installedUiFeatures, { session: hostSession });

      expect(merged.session).toBe(hostSession);
    });

    it("keeps this package's install whole when the host brings nothing", () => {
      const merged = mergeUiFeatureInstalls(installedUiFeatures);

      expect(Object.keys(merged.loaders ?? {}).sort()).toEqual(
        [
          ...AGENT_PAGE_KEYS,
          ...ANALYTICS_PAGE_KEYS,
          ...ANNOTATION_PAGE_KEYS,
          ...API_KEY_PAGE_KEYS,
          ...AUTHZ_PAGE_KEYS,
          ...AUTOMATION_PAGE_KEYS,
          ...DATA_GOVERNANCE_PAGE_KEYS,
          ...DATASET_PAGE_KEYS,
          ...EVALUATOR_PAGE_KEYS,
          ...GATEWAY_PAGE_KEYS,
          ...GOVERNANCE_PAGE_KEYS,
          ...MODEL_PROVIDER_PAGE_KEYS,
          ...MONITOR_PAGE_KEYS,
          ...OPS_PAGE_KEYS,
          ...ORGANIZATION_PAGE_KEYS,
          ...PROMPT_PAGE_KEYS,
          ...SECRET_PAGE_KEYS,
          ...PERSONAL_WORKSPACE_PAGE_KEYS,
        ].sort(),
      );
      expect(merged.apis).toHaveLength(20);
      expect(merged.session).toBe(installedUiFeatures.session);
    });
  });
});
