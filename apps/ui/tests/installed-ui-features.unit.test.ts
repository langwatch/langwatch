/** What this package installs for itself, and how a host's install merges over it. */

import { describe, expect, it } from "vitest";
import { UiFeedbackPort } from "../src/behavior/ui-capabilities";
import { installedUiFeatures } from "../src/features/installed-ui-features";

const AGENT_PAGE_KEYS = [
  // ONE key for ONE screen, and it still names the platform adapter that used
  // to serve it. The route transcript is the parity bar for the URL surface and
  // fails on any page-key change, so the key was left alone rather than spent
  // on a cosmetic rename — several other families' keys name platform modules
  // that no longer exist either.
  "runtime/ui/features/agent-ui-host.adapter",
];

const ANALYTICS_PAGE_KEYS = [
  // Nine keys for eight screens: the chart builder serves two, told apart by a `mode` prop.
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
  // Five keys, one screen (view-as-prop) — except `my-queue`, whose walker
  // mounts `@langwatch/trace-web`'s conversation view with its own screen.
  "pages/[project]/annotations",
  "pages/[project]/annotations/me",
  "pages/[project]/annotations/all",
  "pages/[project]/annotations/[slug]",
  "pages/[project]/annotations/my-queue",
];

const EXPERIMENT_PAGE_KEYS = [
  // Five keys, four screens — the retired evaluation wizard's forward lives
  // here since its only read is `experiments.getExperimentBySlugOrId`.
  "pages/[project]/experiments/index",
  "pages/[project]/experiments/[experiment]",
  "pages/[project]/experiments/workbench/index",
  "pages/[project]/experiments/workbench/[slug]",
  "pages/[project]/evaluations/wizard/[slug]",
];

const EVALUATION_EDIT_PAGE_KEYS = [
  // TWO keys, ONE screen, exactly as `platform/app` registered them: the
  // `.../edit/choose` address predates the drawer that superseded this form and
  // has always resolved the same module.
  "pages/[project]/evaluations/[id]/edit",
  "pages/[project]/evaluations/[id]/edit/choose",
];

const API_KEY_PAGE_KEYS = [
  // Shipped together: `/cli/auth` imports files the Settings > API Keys move owns.
  "pages/settings/api-keys",
  "pages/cli/auth",
];

const AUTHORIZE_PAGE_KEYS = [
  // Screens of `@langwatch/api-key-web`, not a package of their own — both read the same procedure. Neither carries a page-level grant.
  "pages/authorize",
  "pages/mcp/authorize",
];

const ONBOARDING_PAGE_KEYS = [
  // The four `/onboarding/*` addresses sit outside the chrome (no project yet, no grant); `/:project/setup` is inside it, guarded by `project:view`.
  "pages/onboarding",
  "pages/onboarding/welcome",
  "pages/onboarding/product/index",
  "pages/onboarding/[team]/project",
  "pages/[project]/setup",
];

const SECRET_PAGE_KEYS = [
  // One key, its own package. `secrets.*` is `@langwatch/secret-server`'s
  // transport and every type on the page is `@langwatch/secret-contract`'s, so
  // the data-governance family's rule — a key belongs to the family that owns
  // its transport — puts it here rather than in the API key package it moved
  // alongside.
  "pages/settings/secrets",
];

const AUTH_PAGE_KEYS = [
  // The front door: eight addresses a person reaches with NO SESSION AT ALL,
  // which is what makes them one family however differently they are wired.
  // The only family in this package whose loaders carry no page guard, and
  // deliberately so — a grant in front of these would be a gate in front of the
  // way in.
  "pages/auth/signin",
  "pages/auth/signup",
  "pages/auth/forgot-password",
  "pages/auth/reset-password",
  "pages/auth/verify-email",
  "pages/auth/error",
  "pages/auth/join",
  // `/invite/accept` is the eighth: it is not under `/auth`, and it is the
  // front door all the same — an invitation link is the way in for somebody
  // who has no account yet.
  "pages/invite/accept",
];

/** A key, not a page: the route table entry that names it carries children and no path. */
const CHROME_PAGE_KEYS = ["features/chrome/UiAppChrome"];

/**
 * The root address, `/`. Its whole body is the landing redirect, and it carries
 * no page guard for the same reason the front door carries none.
 */
const NAVIGATION_PAGE_KEYS = ["pages/@project/[...path]/index", "pages/index", "pages/not-found"];

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
  // The public unsubscribe landing rides on this family's transport and
  // nothing else: a recipient opening it from a mail client holds no session,
  // so it carries no guard and no host. It is registered here because
  // `emailSuppression.*` is mounted out of `@langwatch/automation-server`.
  "pages/unsubscribe",
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

const GITHUB_PAGE_KEYS = [
  // ONE key, and the ranking row said two. The route table declares a single
  // `/settings/integrations` row and nothing else in it names an integration,
  // so the row's second key was a guess about a sibling that does not exist.
  "pages/settings/integrations",
];

const ORGANIZATION_PAGE_KEYS = [
  // A key belongs to the family that owns its transport — all five read the `organization`, `team` or `group` routers.
  "pages/settings/audit-log",
  "pages/settings/groups",
  "pages/settings/members",
  "pages/settings/teams",
  "pages/settings/teams/[team]",
];

const ANNOTATION_SCORES_PAGE_KEYS = [
  // Its own feature root rather than part of the annotations family, because
  // the four list keys moved as a family of their own and this settings page
  // arrived after them. The screen is the annotation package's second screen
  // scope, so the two share one React Query cache.
  "pages/settings/annotation-scores",
];

const BILLING_PAGE_KEYS = [
  // Three keys, one Enterprise package. Plans, the subscription it buys and
  // the usage it is measured against all read `plan`, `limits` and
  // `subscription`, which are `@langwatch/enterprise-billing-server`'s.
  "pages/settings/plans",
  "pages/settings/subscription",
  "pages/settings/usage",
];

const LICENSING_PAGE_KEYS = [
  // `license.getStatus`/`upload`/`remove`/`generate` are the licensing
  // package's own transport, so the page that drives them belongs to it.
  "pages/settings/license",
];

const NOTIFICATION_PAGE_KEYS = [
  // THE ONE KEY WHOSE TRANSPORT AND SUBJECT DISAGREE, recorded rather than
  // hidden: `emailSuppression.*` is mounted from `@langwatch/automation-server`
  // because a suppression is what a trigger's email hit, but the page is about
  // notification delivery and reads as notification to the customer. Subject
  // won; the tension is written down in the screens index.
  "pages/settings/email-suppressions",
];

const PROJECT_PAGE_KEYS = [
  // The general settings page, which edits the organization AND the project in
  // scope. `organization.update` and `project.update` are its two mutations.
  "pages/settings",
];

const SCIM_PAGE_KEYS = [
  // `scimToken.list`/`generate`/`revoke` are the SCIM package's transport.
  "pages/settings/scim",
];

const TOPIC_PAGE_KEYS = [
  // `topics.getClusteringStatus` and `project.triggerTopicClustering`, which
  // is the topic family's own transport.
  "pages/settings/topic-clustering",
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

const WORKFLOW_PAGE_KEYS = [
  // ALL THREE keys of the ranking row. The studio was recorded as blocked on a
  // copy set of 220 `platform/app` modules; under the deletes-only ruling those
  // stopped being copies and became moves — the trace, experiment, evaluator,
  // dataset, prompt and model-provider vocabularies each went to the package
  // that owns them, and what no feature owns stayed with the studio.
  "pages/[project]/workflows",
  "pages/[project]/chat/[workflow]",
  "pages/[project]/studio/[workflow]",
];

/** The Langy dock's layout key: a key, not a page, so the dock stays mounted while pages below it swap. */
const LANGY_PAGE_KEYS = ["features/langy/ProjectLangyLayout"];

/** One board key answers three route-table rows: a catch-all page serves All Runs, a run plan and an external set. */
const SIMULATION_PAGE_KEYS = [
  "pages/[project]/simulations/[[...path]]",
  "pages/[project]/simulations/scenarios/index",
  "pages/[project]/agent-testing/[[...path]]",
];

const TRACE_PAGE_KEYS = [
  // The Trace Explorer, and the read-only page a share link lands on. Two keys,
  // two screens, and only the first of them takes a grant: `/share/:id` is
  // reachable signed out by design.
  "pages/[project]/traces",
  "pages/share/[id]",
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

/** The project home, `/[project]`: the last legacy loader `platform/app` held. No page-level grant — scope resolution already decided reachability. */
const HOME_PAGE_KEYS = ["pages/[project]/index"];

describe("given what apps/ui serves itself", () => {
  describe("when the standing declaration is read", () => {
    it("registers a loader for every page key the families it serves name", () => {
      expect(Object.keys(installedUiFeatures.loaders ?? {}).sort()).toEqual(
        [
          ...AGENT_PAGE_KEYS,
          ...ANALYTICS_PAGE_KEYS,
          ...ANNOTATION_PAGE_KEYS,
          ...ANNOTATION_SCORES_PAGE_KEYS,
          ...API_KEY_PAGE_KEYS,
          ...AUTH_PAGE_KEYS,
          ...AUTHORIZE_PAGE_KEYS,
          ...AUTHZ_PAGE_KEYS,
          ...AUTOMATION_PAGE_KEYS,
          ...BILLING_PAGE_KEYS,
          ...CHROME_PAGE_KEYS,
          ...DATA_GOVERNANCE_PAGE_KEYS,
          ...DATASET_PAGE_KEYS,
          ...EVALUATION_EDIT_PAGE_KEYS,
          ...EVALUATOR_PAGE_KEYS,
          ...EXPERIMENT_PAGE_KEYS,
          ...GATEWAY_PAGE_KEYS,
          ...GITHUB_PAGE_KEYS,
          ...GOVERNANCE_PAGE_KEYS,
          ...HOME_PAGE_KEYS,
          ...LICENSING_PAGE_KEYS,
          ...MODEL_PROVIDER_PAGE_KEYS,
          ...MONITOR_PAGE_KEYS,
          ...NAVIGATION_PAGE_KEYS,
          ...NOTIFICATION_PAGE_KEYS,
          ...ONBOARDING_PAGE_KEYS,
          ...OPS_PAGE_KEYS,
          ...ORGANIZATION_PAGE_KEYS,
          ...PROJECT_PAGE_KEYS,
          ...PROMPT_PAGE_KEYS,
          ...SCIM_PAGE_KEYS,
          ...SECRET_PAGE_KEYS,
          ...LANGY_PAGE_KEYS,
          ...SIMULATION_PAGE_KEYS,
          ...TOPIC_PAGE_KEYS,
          ...TRACE_PAGE_KEYS,
          ...WORKFLOW_PAGE_KEYS,
          ...PERSONAL_WORKSPACE_PAGE_KEYS,
        ].sort(),
      );
    });

    it("mounts each feature's own transport Provider", () => {
      // One more binding than there are features: the personal workspace mounts
      // two, because the coding-agent tables its screens render call procedures
      // of their own and `apps/ui` may not import the package they live in.
      expect(installedUiFeatures.apis?.map((api) => api.name)).toEqual([
        "@langwatch/agent-web",
        "@langwatch/analytics-web",
        "@langwatch/annotation-web",
        "@langwatch/annotation-web/screens/annotation-scores",
        "@langwatch/api-key-web",
        "@langwatch/auth-web",
        "@langwatch/authz-web",
        "@langwatch/automation-web",
        "@langwatch/enterprise-billing-web",
        "@langwatch/data-privacy-web",
        "@langwatch/data-retention-web",
        "@langwatch/dataset-web",
        "@langwatch/evaluator-web",
        "@langwatch/gateway-web",
        "@langwatch/github-web",
        "@langwatch/enterprise-governance-web",
        // The project home. `@langwatch/project-web` appears TWICE in this list
        // and that is right: the package publishes two screens with two host
        // ports — `/[project]` and `/settings` — and each frontend feature
        // mounts the Provider its own hooks run on.
        "@langwatch/project-web",
        "@langwatch/langy-web",
        "@langwatch/enterprise-licensing-web",
        "@langwatch/model-provider-web",
        "@langwatch/monitor-web",
        "@langwatch/navigation-web",
        "@langwatch/notification-web",
        "@langwatch/onboarding-web",
        "@langwatch/ops-web",
        "@langwatch/organization-web",
        "@langwatch/project-web/screens/project",
        "@langwatch/prompt-web",
        "@langwatch/enterprise-scim-web",
        "@langwatch/secret-web",
        "@langwatch/scenario-web",
        "@langwatch/topic-web",
        "@langwatch/trace-web",
        "@langwatch/workflow-web",
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
});
