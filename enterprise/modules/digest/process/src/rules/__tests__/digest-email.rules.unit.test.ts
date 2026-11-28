// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a member's weekly email says: the rows' input read off the week's folds, and the props
 * `@langwatch/mail`'s digest-week template is rendered with, parsed by its own schema.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { mailTemplates } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import {
  buildDigestWeekProps,
  derivePlanUsage,
  type DigestProjectName,
  digestRowsInput,
  evaluatorOf,
  type OrganizationWeek,
} from "../digest-email.rules.ts";
import {
  emptyProjectWeek,
  emptyUserWeek,
  type ProjectWeek,
  type UserWeekState,
} from "../digest-week.rules.ts";

const fold = (overrides: Partial<ProjectWeek>): ProjectWeek => ({
  ...emptyProjectWeek(),
  traces: 0,
  errors: 0,
  tokens: 0,
  costUsd: 0,
  p50Ms: 0,
  p95Ms: 0,
  models: {},
  projectId: "project-1",
  organizationId: "org-1",
  isoWeek: "2026-W46",
  ...overrides,
});

/** The week of the member `propsFor` builds for, five coding-agent sessions by default. */
const userFold = (overrides: Partial<UserWeekState>): UserWeekState => ({
  ...emptyUserWeek(),
  userId: "u",
  organizationId: "org-1",
  isoWeek: "2026-W46",
  sessions: ["s1", "s2", "s3", "s4", "s5"],
  ...overrides,
});

/** One converged metric series, as the fold keeps it. */
const series = (metric: string, value: number) => ({ metric, type: null, value });

const BASE = "https://app.example.test";
const PREFERENCES = `${BASE}/settings/profile#email-preferences`;
/** Inside 2026-W47: the plan's count starts again on Dec 1. */
const NOW = Date.parse("2026-11-16T09:00:00Z");
const NAMES = new Map<string, DigestProjectName>([
  ["project-1", { name: "Support bot", slug: "support-bot" }],
]);

const template = mailTemplates.find((candidate) => candidate.id === "digest-week");

function propsFor({
  week: organizationWeek,
  admin = false,
  projects = NAMES,
}: {
  week: OrganizationWeek;
  admin?: boolean;
  projects?: ReadonlyMap<string, DigestProjectName>;
}) {
  const props = buildDigestWeekProps({
    week: organizationWeek,
    userId: "u",
    admin,
    mode: "auto",
    organizationName: "Acme",
    projects,
    baseUrl: BASE,
    preferencesUrl: PREFERENCES,
    now: NOW,
  });
  // The template's own schema refuses a wrong shape.
  if (props) template?.schema.parse(props);
  return props;
}

const codingRowOf = (props: ReturnType<typeof propsFor>) =>
  props?.rows.find((row) => row.kind === "coding");

function week(overrides: Partial<OrganizationWeek> = {}): OrganizationWeek {
  return {
    organizationId: "org-1",
    isoWeek: "2026-W46",
    planUsage: { used: 100, limit: 1_000 },
    projects: [],
    history: [],
    previousTraces: new Map(),
    users: new Map(),
    ...overrides,
  };
}

describe("derivePlanUsage()", () => {
  describe("when the plan is uncapped", () => {
    it("has no usage to press on", () => {
      const uncapped = {
        currentMonthMessagesCount: 5,
        maxMonthlyUsageLimit: Number.MAX_SAFE_INTEGER,
      };

      expect(derivePlanUsage(uncapped)).toBeUndefined();
    });
  });

  describe("when the count is unknown", () => {
    it("has no usage to press on", () => {
      const unknown = { currentMonthMessagesCount: null, maxMonthlyUsageLimit: 1_000 };

      expect(derivePlanUsage(unknown)).toBeUndefined();
    });
  });
});

describe("buildDigestWeekProps()", () => {
  describe("when the busiest project traced 1,200 times, up from 1,000 last week", () => {
    const busy = week({
      projects: [
        fold({
          traces: 1_200,
          errors: 12,
          costUsd: 3.5,
          p95Ms: 2_400.4,
          models: { "gpt-5": 700, "claude-sonnet": 500 },
        }),
      ],
      previousTraces: new Map([["project-1", 1_000]]),
    });

    it("shows its traces row with the top model and links built on the origin", () => {
      const props = propsFor({ week: busy });

      expect(props?.rows.find((row) => row.kind === "traces")).toEqual({
        kind: "traces",
        projectName: "Support bot",
        traces: 1_200,
        previousTraces: 1_000,
        errors: 12,
        costUsd: 3.5,
        p95Milliseconds: 2_400,
        topModel: { name: "gpt-5", traces: 700 },
        url: `${BASE}/support-bot/traces`,
      });
      expect(props).toMatchObject({
        weekLabel: "Nov 9 to 15",
        preferencesUrl: PREFERENCES,
        organizationName: "Acme",
        everythingUrl: BASE,
      });
    });

    /** @scenario "A row whose project has no name is left out of the email" */
    it("sends nothing when the only project's name cannot be read", () => {
      expect(propsFor({ week: busy, projects: new Map() })).toBeUndefined();
    });
  });

  describe("when an admin's organization is at 90% of its plan", () => {
    it("shows the plan row with the count, the limit and when it resets", () => {
      const props = propsFor({
        week: week({ planUsage: { used: 900, limit: 1_000 } }),
        admin: true,
      });

      expect(props?.rows).toEqual([
        {
          kind: "plan",
          used: 900,
          limit: 1_000,
          daysLeft: 15,
          resetsOn: "Dec 1",
          url: `${BASE}/settings/usage`,
          upgradeUrl: `${BASE}/settings/subscription`,
        },
      ]);
    });
  });

  describe("when a member had five coding-agent sessions", () => {
    const codingWeek = (user: UserWeekState) => week({ users: new Map([["u", user]]) });

    /** @scenario "A coding-agent row never shows cost" */
    it("shows every count the agent reported, and no cost", () => {
      const reported = userFold({
        series: {
          input: series("token_usage", 1_000.4),
          output: series("token_usage", 200),
          cost: series("cost_usage", 12.5),
          commits: series("commit", 4),
          pulls: series("pull_request", 2),
        },
        repositories: { "acme/api": 5 },
      });

      expect(codingRowOf(propsFor({ week: codingWeek(reported) }))).toEqual({
        kind: "coding",
        sessions: 5,
        tokens: 1_200,
        commits: 4,
        pullRequests: 2,
        topRepository: { name: "acme/api", sessions: 5 },
        totalsAtLeast: false,
        url: BASE,
      });
    });

    /** @scenario "A coding-agent row never shows cost" */
    it("leaves out each optional count, and the repository, when none was reported", () => {
      const row = codingRowOf(propsFor({ week: codingWeek(userFold({})) }));

      for (const optional of ["commits", "pullRequests", "topRepository"]) {
        expect(row).not.toHaveProperty(optional);
      }
    });

    /** @scenario "A coding-agent week names the repository with the most sessions" */
    it("names the repository with the most sessions as the top one", () => {
      const repositories = { "acme/web": 1, "acme/api": 3, "acme/docs": 2 };

      expect(codingRowOf(propsFor({ week: codingWeek(userFold({ repositories })) }))).toMatchObject(
        { topRepository: { name: "acme/api", sessions: 3 } },
      );
    });

    /** @scenario "A person's week past its series cap reads its totals as floors" */
    it("marks the totals as floors when the week dropped series past its cap", () => {
      const capped = userFold({ series: { input: series("token_usage", 2) }, seriesOverflow: 4 });

      expect(codingRowOf(propsFor({ week: codingWeek(capped) }))).toMatchObject({
        tokens: 2,
        totalsAtLeast: true,
      });
    });
  });

  describe("when the week has nothing to say", () => {
    /** @scenario "A member whose week has nothing to show is sent nothing" */
    it("builds no props, so nothing is sent", () => {
      expect(propsFor({ week: week() })).toBeUndefined();
    });
  });
});

describe("digestRowsInput()", () => {
  describe("when a project has evals this week and in the four weeks before", () => {
    it("sums the baseline's checks per evaluator and counts every eval run", () => {
      const input = digestRowsInput({
        week: week({
          projects: [
            fold({
              evaluators: { "ragas/faithfulness": { runs: 12, passed: 9, failed: 1 } },
            }),
          ],
          history: [
            fold({
              isoWeek: "2026-W45",
              evaluators: { "ragas/faithfulness": { runs: 5, passed: 4, failed: 1 } },
            }),
            fold({
              isoWeek: "2026-W41",
              evaluators: { "ragas/faithfulness": { runs: 5, passed: 4, failed: 1 } },
            }),
          ],
        }),
        userId: "u",
        admin: false,
        mode: "auto",
      });

      expect(input.projects[0]).toMatchObject({
        evaluators: [
          {
            evaluatorType: "ragas/faithfulness",
            week: { total: 10, failed: 1 },
            baseline: { total: 5, failed: 1 },
          },
        ],
        evaluationRuns: 17,
        previousTraces: null,
      });
    });
  });
});

describe("evaluatorOf()", () => {
  it("names a catalogue evaluator from its type, and calls a custom or workflow one custom", () => {
    expect(evaluatorOf("ragas/faithfulness")).toEqual({ kind: "catalogue", name: "faithfulness" });
    expect(evaluatorOf("langevals/pii_detection")).toEqual({
      kind: "catalogue",
      name: "pii detection",
    });
    for (const custom of ["custom", "custom/evaluator_abc123", "workflow/wf_1"]) {
      expect(evaluatorOf(custom)).toEqual({ kind: "custom" });
    }
  });
});
