// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The studio's three organisation shapes are what the digest's own rules build: each shape's
 * week, as fake folds, run through `buildDigestWeekProps` for an admin and a member, equals the
 * `@langwatch/mail` digest-week fixture of that name.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { mailTemplates } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import {
  buildDigestWeekProps,
  type DigestProjectName,
  type OrganizationWeek,
} from "../digest-email.rules.ts";
import {
  emptyProjectWeek,
  emptyUserWeek,
  type OutcomeCounts,
  type ProjectWeek,
  type ProjectWeekState,
} from "../digest-week.rules.ts";

const BASE = "https://app.langwatch.ai";
const SENT_WEEK = "2026-W47";
/** Monday after the sent week: 8 days until Dec 1. */
const NOW = Date.parse("2026-11-23T09:00:00Z");
const READER = "reader";

const outcomes = (runs: number, failed: number): OutcomeCounts => ({
  runs,
  passed: runs - failed,
  failed,
});

const week = (projectId: string, overrides: Partial<ProjectWeek> = {}): ProjectWeek => ({
  ...emptyProjectWeek(),
  traces: 0,
  errors: 0,
  tokens: 0,
  costUsd: 0,
  p50Ms: 0,
  p95Ms: 0,
  models: {},
  projectId,
  organizationId: "org",
  isoWeek: SENT_WEEK,
  ...overrides,
});

/** The four weeks before, summed into one of them: the baseline only reads their sum. */
const baseline = (projectId: string, overrides: Partial<ProjectWeekState>): ProjectWeekState => ({
  ...emptyProjectWeek(),
  projectId,
  organizationId: "org",
  isoWeek: "2026-W46",
  ...overrides,
});

type Shape = Readonly<{
  organizationName: string;
  week: OrganizationWeek;
  names: Record<string, string>;
}>;

const organizationWeek = (overrides: Partial<OrganizationWeek>): OrganizationWeek => ({
  organizationId: "org",
  isoWeek: SENT_WEEK,
  planUsage: null,
  projects: [],
  history: [],
  previousTraces: new Map(),
  users: new Map(),
  ...overrides,
});

const thin: Shape = {
  organizationName: "Oakridge Studio",
  names: { "docs-helper": "Docs helper" },
  week: organizationWeek({
    planUsage: { used: 4_000, limit: 1_000_000 },
    projects: [
      week("docs-helper", {
        traces: 37,
        errors: 2,
        costUsd: 0.41,
        p95Ms: 2_600,
        models: { "gpt-5-mini": 31, "gpt-5": 6 },
      }),
    ],
    previousTraces: new Map([["docs-helper", 12]]),
  }),
};

const moderate: Shape = {
  organizationName: "Harbourline",
  names: {
    "support-agent": "Support agent",
    "order-search": "Order search",
    "returns-helper": "Returns helper",
  },
  week: organizationWeek({
    planUsage: { used: 410_000, limit: 1_000_000 },
    projects: [
      week("support-agent", {
        traces: 4_210,
        errors: 38,
        costUsd: 41.2,
        p95Ms: 3_400,
        models: { "gpt-5-mini": 3_020, "gpt-5": 1_190 },
        scenarios: outcomes(48, 9),
        evaluators: {
          "langevals/tone": outcomes(380, 72),
          "ragas/faithfulness": outcomes(400, 16),
        },
      }),
      week("order-search"),
      week("returns-helper", { traces: 120 }),
    ],
    history: [
      baseline("support-agent", {
        scenarios: outcomes(200, 12),
        evaluators: {
          "langevals/tone": outcomes(1_600, 112),
          "ragas/faithfulness": outcomes(1_600, 64),
        },
      }),
    ],
    previousTraces: new Map([
      ["support-agent", 3_760],
      ["order-search", 640],
      ["returns-helper", 100],
    ]),
  }),
};

const flooded: Shape = {
  organizationName: "Quillmark",
  names: {
    "checkout-agent": "Checkout agent",
    "claims-triage": "Claims triage",
    "internal-search": "Internal search",
    "billing-bot": "Billing bot",
    "search-ranker": "Search ranker",
    "docs-agent": "Docs agent",
  },
  week: organizationWeek({
    planUsage: { used: 940_210, limit: 1_000_000 },
    projects: [
      week("checkout-agent", {
        traces: 412_800,
        errors: 9_870,
        costUsd: 3_912.55,
        p95Ms: 6_800,
        models: { "gpt-5": 251_300, "claude-sonnet-4": 120_400, "gpt-5-mini": 41_100 },
        scenarios: outcomes(240, 74),
        evaluators: {
          "ragas/faithfulness": outcomes(12_600, 504),
          "langevals/pii_detection": outcomes(12_600, 126),
          "langevals/refund_policy": outcomes(12_600, 1_512),
        },
      }),
      week("claims-triage", {
        traces: 150_000,
        scenarios: outcomes(100, 7),
        evaluators: { "ragas/faithfulness": outcomes(1_000, 40) },
      }),
      week("internal-search"),
      week("billing-bot", { traces: 60_000 }),
      week("search-ranker", { traces: 30_000 }),
      week("docs-agent", { traces: 6_950 }),
    ],
    history: [
      baseline("checkout-agent", {
        scenarios: outcomes(1_000, 90),
        evaluators: {
          "ragas/faithfulness": outcomes(50_000, 2_000),
          "langevals/pii_detection": outcomes(50_000, 500),
          "langevals/refund_policy": outcomes(50_000, 1_000),
        },
      }),
      baseline("claims-triage", {
        scenarios: outcomes(400, 16),
        evaluators: { "ragas/faithfulness": outcomes(4_000, 160) },
      }),
    ],
    previousTraces: new Map([
      ["checkout-agent", 378_700],
      ["claims-triage", 140_000],
      ["internal-search", 2_140],
      ["billing-bot", 59_000],
      ["search-ranker", 31_000],
      ["docs-agent", 7_000],
    ]),
    users: new Map([
      [
        READER,
        {
          ...emptyUserWeek(),
          userId: READER,
          organizationId: "org",
          isoWeek: SENT_WEEK,
          sessions: Array.from({ length: 64 }, (_, index) => `session-${index}`),
          series: {
            tokens: { metric: "token_usage", type: null, value: 41_200_000 },
            cost: { metric: "cost_usage", type: null, value: 318.4 },
            commits: { metric: "commit", type: null, value: 23 },
            pulls: { metric: "pull_request", type: null, value: 7 },
          },
          repositories: { "quillmark/checkout-service": 38, "quillmark/claims": 26 },
        },
      ],
    ]),
  }),
};

const SHAPES = { thin, moderate, flooded } as const;

const fixtureNamed = (name: string) =>
  mailTemplates
    .find((template) => template.id === "digest-week")
    ?.fixtures.find((fixture) => fixture.name === name)?.props;

const build = ({ shape, admin }: { shape: Shape; admin: boolean }) =>
  buildDigestWeekProps({
    week: shape.week,
    userId: READER,
    admin,
    mode: "auto",
    organizationName: shape.organizationName,
    projects: new Map(
      Object.entries(shape.names).map(([id, name]): [string, DigestProjectName] => [
        id,
        { name, slug: id },
      ]),
    ),
    baseUrl: BASE,
    preferencesUrl: `${BASE}/settings/profile#email-preferences`,
    now: NOW,
  });

describe("the digest-week studio fixtures", () => {
  describe.each(Object.keys(SHAPES) as (keyof typeof SHAPES)[])(
    "given the %s organisation",
    (id) => {
      describe.each(["admin", "member"] as const)("when read as an %s", (reader) => {
        /** @scenario "The studio's fixtures are what the digest's rules build" */
        it("equals the fixture the studio shows", () => {
          const expected = fixtureNamed(`${id} organisation, ${reader}`);

          expect(expected).toBeDefined();
          expect(build({ shape: SHAPES[id], admin: reader === "admin" })).toEqual(expected);
        });
      });
    },
  );

  describe("given the thin organisation with no traces this week or last", () => {
    /** @scenario "An organization with no traces this week or last is sent nothing" */
    it("builds no email", () => {
      const silent: Shape = {
        ...thin,
        week: organizationWeek({
          planUsage: thin.week.planUsage,
          projects: [week("docs-helper")],
          previousTraces: new Map([["docs-helper", 0]]),
        }),
      };

      expect(build({ shape: silent, admin: true })).toBeUndefined();
    });
  });
});
