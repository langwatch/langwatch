import { moduleApi, type Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

const seedActionOutcomeSchemaDefinition = z.discriminatedUnion("status", [
  z.object({ status: z.literal("succeeded"), summary: z.string() }),
  z.object({ status: z.literal("skipped"), reason: z.string() }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);
export interface SeedActionOutcomeSchema extends Named<typeof seedActionOutcomeSchemaDefinition> {}
export const seedActionOutcomeSchema: SeedActionOutcomeSchema = seedActionOutcomeSchemaDefinition;

export type SeedActionOutcome = z.infer<typeof seedActionOutcomeSchema>;

/** One run over the demo organization: every action's outcome, in either mode. */
const seedRunReportSchemaDefinition = z.object({
  startedAt: z.string(),
  completedAt: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  mode: z.enum(["dry-run", "execute"]),
  actions: z.array(
    z.object({ name: z.string(), outcome: seedActionOutcomeSchema, durationMs: z.number() }),
  ),
});
export interface SeedRunReportSchema extends Named<typeof seedRunReportSchemaDefinition> {}
export const seedRunReportSchema: SeedRunReportSchema = seedRunReportSchemaDefinition;

export type SeedRunReport = z.infer<typeof seedRunReportSchema>;

/** Dry-run unless `execute`; the target defaults to the first allowlisted organization. */
const demoDataRunInputSchemaDefinition = z.object({
  execute: z.boolean(),
  organizationId: z.string().min(1).optional(),
});
export interface DemoDataRunInputSchema extends Named<typeof demoDataRunInputSchemaDefinition> {}
export const demoDataRunInputSchema: DemoDataRunInputSchema = demoDataRunInputSchemaDefinition;

export type DemoDataRunInput = z.infer<typeof demoDataRunInputSchema>;

/** The demo instance's seeding: one run over an allowlisted demo organization. */
export interface DemoDataApi {
  runSeedDemo(input: DemoDataRunInput): Promise<SeedRunReport>;
}

export const DemoDataApi = moduleApi<DemoDataApi>()("demo-data");
