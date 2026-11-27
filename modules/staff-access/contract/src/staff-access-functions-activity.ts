/**
 * The activity ops functions (ADR-202): what an organization did with coding agents, the
 * gateway, Instant Evals and scenarios, as counts per day or week. No names, no content.
 * Spec: modules/staff-access/specs/staff-access-functions-activity.feature
 */
import { z } from "zod";

import {
  countsByCode,
  entry,
  isoTime,
  pageInput,
  rangeInput,
  staffAccessPageSchema,
  type StaffAccessFunctionEntry,
} from "./staff-access-function-shapes.ts";

/** How many weeks back `org.activity_weekly` reads at most. */
const STAFF_ACCESS_ACTIVITY_MAX_WEEKS = 26;

export const STAFF_ACCESS_ACTIVITY_FUNCTIONS = {
  "org.coding_agents": entry({
    title: "Coding agent sessions per day, project and agent",
    scope: "org",
    answers: "Whether and how much the organization uses coding agents, and which agents.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          day: isoTime,
          projectId: z.string(),
          agent: z.string(),
          sessions: z.number().int(),
          users: z.number().int(),
        })
        .strict(),
    ),
  }),
  "org.gateway_spend": entry({
    title: "Gateway requests and spend per day, virtual key and provider",
    scope: "org",
    answers: "What the gateway ledger charged per virtual key, to compare with a budget or a bill.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          day: isoTime,
          projectId: z.string(),
          virtualKeyId: z.string(),
          providerId: z.string(),
          requests: z.number().int(),
          failedRequests: z.number().int(),
          spendUsd: z.number(),
        })
        .strict(),
    ),
  }),
  "org.instant_evals": entry({
    title: "Instant Eval runs per week and project: rows judged, failures by code, price",
    scope: "org",
    answers: "Whether the organization uses Instant Evals, how big its runs are and why they fail.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          week: isoTime,
          projectId: z.string(),
          runs: z.number().int(),
          judgedRows: z.number().int(),
          largestRun: z.number().int(),
          failedRuns: z.number().int(),
          failedByCode: countsByCode,
          priceUsd: z.number(),
          lastRunAt: isoTime,
        })
        .strict(),
    ),
  }),
  "org.activity_weekly": entry({
    title: "Weekly activity: traces, evaluations, Instant Evals, scenarios, agents, gateway",
    scope: "org",
    answers: "Whether an organization is still active, and since which week it went quiet.",
    input: z
      .object({
        /** Whole weeks back from this one, Monday to Monday in UTC, this week included. */
        weeks: z.number().int().min(1).max(STAFF_ACCESS_ACTIVITY_MAX_WEEKS),
        ...pageInput,
      })
      .strict(),
    output: staffAccessPageSchema(
      z
        .object({
          week: isoTime,
          traces: z.number().int(),
          evaluations: z.number().int(),
          instantEvalRuns: z.number().int(),
          scenarioRuns: z.number().int(),
          codingAgentSessions: z.number().int(),
          gatewayRequests: z.number().int(),
          /** Members with a browser session at or after the week's start. */
          membersActiveSinceWeekStart: z.number().int(),
        })
        .strict(),
    ),
  }),
  "scenarios.runs_by_org": entry({
    title: "Scenario runs per organization: plan, projects, suites, runs, failures",
    scope: "platform",
    answers: "How many organizations run scenarios and how much, for example to size a plan cap.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          organizationId: z.string(),
          plan: z.string(),
          projects: z.number().int(),
          suites: z.number().int(),
          runs: z.number().int(),
          failedRuns: z.number().int(),
        })
        .strict(),
    ),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;
