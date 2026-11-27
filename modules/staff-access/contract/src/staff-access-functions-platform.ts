/**
 * The platform ops functions (ADR-202): what each service runs, which upgrade steps fail, which
 * evaluators run across the platform, and one organization's retention.
 * Spec: modules/staff-access/specs/staff-access-functions-platform.feature
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

export const STAFF_ACCESS_PLATFORM_FUNCTIONS = {
  "releases.state": entry({
    title: "The release each service runs, the upgrade step counts and allowlisted settings",
    scope: "platform",
    answers: "Whether a change is live, which release each role serves, and a few non-secret ids.",
    input: z.object({}).strict(),
    output: z
      .object({
        installedRelease: z.string().nullable(),
        imageRelease: z.string().nullable(),
        imageCommit: z.string().nullable(),
        upgradeState: z.string(),
        stepsByStatus: countsByCode,
        failedTargets: z.number().int(),
        lastRunOutcome: z.string().nullable(),
        lastRunFinishedAt: isoTime.nullable(),
        services: staffAccessPageSchema(
          z
            .object({
              role: z.string(),
              release: z.string().nullable(),
              imageTag: z.string(),
              processes: z.number().int(),
              since: isoTime,
              lastSeenAt: isoTime,
            })
            .strict(),
        ),
        settings: staffAccessPageSchema(
          z.object({ key: z.string(), set: z.boolean(), value: z.string().nullable() }).strict(),
        ),
      })
      .strict(),
  }),
  "upgrade.step_failures": entry({
    title: "Failed upgrade steps and the tenants a step parked",
    scope: "platform",
    answers: "Which upgrade step keeps failing, with which error code, and on which tenants.",
    input: z
      .object({
        stepId: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[A-Za-z0-9:_./-]+$/)
          .optional(),
        ...pageInput,
      })
      .strict(),
    output: staffAccessPageSchema(
      z
        .object({
          stepId: z.string(),
          mode: z.string(),
          state: z.string(),
          attempt: z.number().int(),
          errorCode: z.string().nullable(),
          failedTenants: z.number().int(),
          /** At most 20; `failedTenants` is the full count. */
          tenantIds: z.array(z.string()),
          lastAttemptAt: isoTime.nullable(),
          /** False when the scan stopped at 10,000 parked tenants: counts are floors. */
          tenantScanComplete: z.boolean(),
        })
        .strict(),
    ),
  }),
  "org.retention": entry({
    title: "Retention days and traces per month for each project",
    scope: "org",
    answers: "Whether traces a customer misses aged out under retention, or never arrived.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          projectId: z.string(),
          tracesRetentionDays: z.number().int(),
          scenariosRetentionDays: z.number().int(),
          experimentsRetentionDays: z.number().int(),
          /** Traces per UTC month (`YYYY-MM`) over the last 12 months, this one included. */
          tracesByMonth: countsByCode,
          oldestMonthWithTraces: z.string().nullable(),
          pendingRetentionRewrites: z.number().int(),
        })
        .strict(),
    ),
  }),
  "evaluators.platform_usage": entry({
    title: "Evaluator runs and failures per evaluator type across the platform",
    scope: "platform",
    answers: "Which evaluators customers run, and which types fail with which codes.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          evaluatorType: z.string(),
          projects: z.number().int(),
          runs: z.number().int(),
          errors: z.number().int(),
          skipped: z.number().int(),
          errorsByCode: countsByCode,
        })
        .strict(),
    ),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;
