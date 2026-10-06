// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

export const DIGEST_TEMPLATE_IDS = [
  "digest-plan-pressure",
  "digest-scenarios-trend",
  "digest-coding-agent-week",
  "digest-traces-week",
  "digest-whats-new",
] as const;

export const digestTemplateIdSchema = z.enum(DIGEST_TEMPLATE_IDS);
export type DigestTemplateId = z.infer<typeof digestTemplateIdSchema>;

/** Tuned from the Cloud admin gallery; the first eligible template wins. */
export const DIGEST_TEMPLATE_THRESHOLDS = {
  planPressurePercent: 80,
  scenarioFailureMovePoints: 10,
  codingAgentSessions: 5,
  traces: 1_000,
} as const;

const count = z.number().int().nonnegative();

const scenarioWeekSchema = z.object({ runs: count, failures: count });

export const digestTemplateInputSchema = z.object({
  member: z.object({
    isOrganizationAdmin: z.boolean(),
    codingAgentSessions: count,
  }),
  organization: z.object({
    /** Month's usage against the plan limit; null when the plan has no limit. */
    monthlyLimitUsedPercent: z.number().nonnegative().nullable(),
  }),
  /** The one project the email is about; null when the member has none. */
  project: z
    .object({
      traces: count,
      scenarioRuns: count,
      scenarioFailures: count,
      /** The four weeks before this one; their order does not matter. */
      baselineWeeks: z.array(scenarioWeekSchema),
    })
    .nullable(),
});
export type DigestTemplateInput = z.infer<typeof digestTemplateInputSchema>;

export const digestTemplatePickSchema = z.discriminatedUnion("template", [
  z.object({ template: z.literal("digest-plan-pressure") }),
  z.object({
    template: z.literal("digest-scenarios-trend"),
    direction: z.enum(["more_failing", "getting_better"]),
  }),
  z.object({ template: z.literal("digest-coding-agent-week") }),
  z.object({ template: z.literal("digest-traces-week") }),
  z.object({ template: z.literal("digest-whats-new") }),
]);
export type DigestTemplatePick = z.infer<typeof digestTemplatePickSchema>;

/** Every eligible template in send order; what's new is always last. */
export function eligibleDigestTemplates(input: DigestTemplateInput): DigestTemplatePick[] {
  const { member, organization, project } = input;
  const eligible: DigestTemplatePick[] = [];

  const used = organization.monthlyLimitUsedPercent;
  if (
    member.isOrganizationAdmin &&
    used !== null &&
    used >= DIGEST_TEMPLATE_THRESHOLDS.planPressurePercent
  ) {
    eligible.push({ template: "digest-plan-pressure" });
  }

  const trend = project ? classifyScenarioTrend({ project }) : "steady";
  if (trend !== "steady") eligible.push({ template: "digest-scenarios-trend", direction: trend });

  if (member.codingAgentSessions >= DIGEST_TEMPLATE_THRESHOLDS.codingAgentSessions) {
    eligible.push({ template: "digest-coding-agent-week" });
  }

  if (project && project.traces >= DIGEST_TEMPLATE_THRESHOLDS.traces) {
    eligible.push({ template: "digest-traces-week" });
  }

  eligible.push({ template: "digest-whats-new" });
  return eligible;
}

export function pickDigestTemplate(input: DigestTemplateInput): DigestTemplatePick {
  const [first] = eligibleDigestTemplates(input);
  return first ?? { template: "digest-whats-new" };
}

/**
 * Compares this week's failure rate with the runs-weighted baseline, in
 * integers so a move of exactly the threshold is never lost to float error.
 * No runs this week or none in the baseline reads as steady.
 */
function classifyScenarioTrend({
  project,
}: {
  project: NonNullable<DigestTemplateInput["project"]>;
}): "more_failing" | "getting_better" | "steady" {
  const baselineRuns = sum(project.baselineWeeks.map((week) => week.runs));
  const baselineFailures = sum(project.baselineWeeks.map((week) => week.failures));
  if (project.scenarioRuns === 0 || baselineRuns === 0) return "steady";

  const moved = project.scenarioFailures * baselineRuns - baselineFailures * project.scenarioRuns;
  const movedPoints = Math.abs(moved) * 100;
  const needed =
    DIGEST_TEMPLATE_THRESHOLDS.scenarioFailureMovePoints * project.scenarioRuns * baselineRuns;
  if (movedPoints < needed) return "steady";
  return moved > 0 ? "more_failing" : "getting_better";
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
