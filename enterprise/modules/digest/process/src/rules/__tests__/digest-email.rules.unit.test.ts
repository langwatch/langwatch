// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a member's weekly email says: the template input read off the week's folds, and the
 * props each picked `@langwatch/mail` template is rendered with, parsed by its own schema.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { mailTemplates } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import {
  buildDigestTemplateProps,
  derivePlanUsage,
  type DigestNames,
  type DigestTemplateProps,
  digestTemplateInput,
  type OrganizationWeek,
  pickHomeOrganization,
} from "../digest-email.rules.ts";
import { pickDigestTemplate } from "../digest-template.rules.ts";
import { emptyProjectWeek, type ProjectWeekState } from "../digest-week.rules.ts";

const fold = (overrides: Partial<ProjectWeekState>): ProjectWeekState => ({
  ...emptyProjectWeek(),
  projectId: "project-1",
  organizationId: "org-1",
  isoWeek: "2026-W46",
  ...overrides,
});

const BASE = "https://app.example.test";
const UNSUBSCRIBE = `${BASE}/api/digest/unsubscribe?token=signed`;
/** Inside 2026-W47: the plan's count starts again on Dec 1. */
const NOW = Date.parse("2026-11-16T09:00:00Z");
const NAMES: DigestNames = {
  organizationName: "Acme",
  project: { name: "Support bot", slug: "support-bot" },
};

/** The props as the template itself reads them: its own schema refuses a wrong shape. */
function parsedBy({
  templateId,
  props,
}: {
  templateId: string;
  props: DigestTemplateProps | undefined;
}) {
  const template = mailTemplates.find((candidate) => candidate.id === templateId);
  if (!template || !props) throw new Error(`no ${templateId} props to parse`);
  return template.schema.parse(props);
}

function propsFor({
  week: organizationWeek,
  admin = false,
  names = NAMES,
}: {
  week: OrganizationWeek;
  admin?: boolean;
  names?: DigestNames;
}) {
  const pick = pickDigestTemplate(
    digestTemplateInput({ week: organizationWeek, userId: "u", admin }),
  );
  return {
    pick,
    props: buildDigestTemplateProps({
      pick,
      week: organizationWeek,
      userId: "u",
      names,
      baseUrl: BASE,
      unsubscribeUrl: UNSUBSCRIBE,
      now: NOW,
    }),
  };
}

function week(overrides: Partial<OrganizationWeek> = {}): OrganizationWeek {
  return {
    organizationId: "org-1",
    isoWeek: "2026-W46",
    planUsage: { used: 100, limit: 1_000 },
    projects: [],
    history: [],
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

describe("buildDigestTemplateProps()", () => {
  describe("when the busiest project traced 1,200 times, up from 1,000 last week", () => {
    const busy = week({
      projects: [
        fold({
          traces: 1_200,
          errors: 12,
          tokens: 4_000.4,
          costUsd: 3.5,
          models: { "gpt-5": 900, "claude-sonnet": 250, mini: 40, other: 10 },
          evaluators: { exact_match: { runs: 10, passed: 8, failed: 2 } },
        }),
      ],
      history: [fold({ isoWeek: "2026-W45", traces: 1_000 })],
    });

    it("renders traces-week with its numbers, top three models first, and its links", () => {
      const { pick, props } = propsFor({ week: busy });

      expect(pick.template).toBe("digest-traces-week");
      expect(parsedBy({ templateId: pick.template, props })).toEqual({
        weekLabel: "Nov 9 to 15",
        unsubscribeUrl: UNSUBSCRIBE,
        projectName: "Support bot",
        traces: 1_200,
        changePercent: 20,
        errors: 12,
        costUsd: 3.5,
        tokens: 4_000,
        p50Milliseconds: 0,
        p95Milliseconds: 0,
        topModels: [
          { name: "gpt-5", traces: 900 },
          { name: "claude-sonnet", traces: 250 },
          { name: "mini", traces: 40 },
        ],
        evaluations: [{ name: "exact_match", passRatePercent: 80 }],
        tracesUrl: `${BASE}/support-bot/traces`,
      });
    });

    it("sends nothing when the project's name cannot be read", () => {
      expect(propsFor({ week: busy, names: { ...NAMES, project: null } }).props).toBeUndefined();
    });
  });

  describe("when the busiest project's scenarios fail more than their baseline", () => {
    const failing = week({
      projects: [fold({ scenarios: { runs: 10, passed: 7, failed: 3 } })],
      history: ["2026-W45", "2026-W44", "2026-W43", "2026-W42"].map((isoWeek) =>
        fold({ isoWeek, scenarios: { runs: 10, passed: 9, failed: 1 } }),
      ),
    });

    it("renders the trend as worse, with both rates", () => {
      const { pick, props } = propsFor({ week: failing });

      expect(parsedBy({ templateId: pick.template, props })).toMatchObject({
        projectName: "Support bot",
        direction: "worse",
        failureRatePercent: 30,
        baselinePercent: 10,
        runs: 10,
        failed: 3,
        scenariosUrl: `${BASE}/support-bot/simulations/scenarios`,
      });
    });
  });

  describe("when an admin's organization is at 90% of its plan", () => {
    const pressed = week({ planUsage: { used: 900, limit: 1_000 } });

    it("renders plan-pressure with the plan's numbers and when the count resets", () => {
      const { pick, props } = propsFor({ week: pressed, admin: true });

      expect(pick.template).toBe("digest-plan-pressure");
      expect(parsedBy({ templateId: pick.template, props })).toMatchObject({
        organizationName: "Acme",
        usagePercentage: 90,
        used: 900,
        limit: 1_000,
        resetsOn: "Dec 1",
        upgradeUrl: `${BASE}/settings/subscription`,
      });
    });
  });

  describe("when a member's pick is the what's new fallback", () => {
    it("sends nothing, since no card is published", () => {
      const { pick, props } = propsFor({ week: week() });

      expect(pick.template).toBe("digest-whats-new");
      expect(props).toBeUndefined();
    });
  });
});

describe("pickHomeOrganization()", () => {
  /** @scenario "A member of two enrolled organizations is sent the busier one's week" */
  it("is the organization with the most activity", () => {
    expect(
      pickHomeOrganization([
        { organizationId: "org-a", activity: 10 },
        { organizationId: "org-b", activity: 30 },
      ]),
    ).toBe("org-b");
  });

  /** @scenario "A member of two enrolled organizations is sent the busier one's week" */
  it("is the lowest organization id on a tie, whatever order they are listed in", () => {
    const tied = [
      { organizationId: "org-b", activity: 5 },
      { organizationId: "org-a", activity: 5 },
    ];
    expect(pickHomeOrganization(tied)).toBe("org-a");
    expect(pickHomeOrganization(tied.toReversed())).toBe("org-a");
  });

  it("is none without candidates", () => {
    expect(pickHomeOrganization([])).toBeUndefined();
  });
});
