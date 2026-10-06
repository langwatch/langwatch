import { Config, type ConfigOf } from "@langwatch/config";
import { moduleApi } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

export const seedActionOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("succeeded"), summary: z.string() }),
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);

export type SeedActionOutcome = z.infer<typeof seedActionOutcomeSchema>;

/** One run over the demo organization: every action's outcome, in either mode. */
export const seedRunReportSchema = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  mode: z.enum(["dry-run", "execute"]),
  actions: z.array(
    z.object({ name: z.string(), outcome: seedActionOutcomeSchema, durationMs: z.number() }),
  ),
});

export type SeedRunReport = z.infer<typeof seedRunReportSchema>;

/** Dry-run unless `execute`; the target defaults to the first allowlisted organization. */
export const demoDataRunInputSchema = z.object({
  execute: z.boolean(),
  organizationId: z.string().min(1).optional(),
});

export type DemoDataRunInput = z.infer<typeof demoDataRunInputSchema>;

/** The demo instance's seeding: one run over an allowlisted demo organization. */
export interface DemoDataApi {
  runSeedDemo(input: DemoDataRunInput): Promise<SeedRunReport>;
}

export const DemoDataApi = moduleApi<DemoDataApi>()("demo-data");

/** Main's gate: the comma-separated organizations the seeding may touch; absent everywhere but the demo instance. */
export const demoDataConfig = Config.define((c) => ({
  demoOrgIds: c.env("DEMO_ORG_IDS", z.string().optional()),
}));

export type DemoDataConfig = ConfigOf<typeof demoDataConfig>;
