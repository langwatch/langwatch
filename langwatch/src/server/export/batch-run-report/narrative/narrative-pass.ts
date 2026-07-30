import { createLogger } from "@langwatch/observability";
import { generateObject } from "ai";
import { z } from "zod";
import type { QuestionDescriptor } from "../questions/question-registry";
import { citationSchema } from "../report.types";
import { buildNarrativeSystemPrompt } from "./prompts";

const logger = createLogger("langwatch:batch-run-report:narrative");

/**
 * The pass that writes the report's prose.
 *
 * One call for every question rather than one per question: the proposal
 * questions have to see the failure grouping this same call produces, and
 * eleven round trips would cost more and read less coherently than one.
 *
 * Deliberately flat rather than a discriminated union per answer shape. A
 * nested union inside an array is the structure most likely to trip a strict
 * JSON-schema provider, and every optional array here is one the model simply
 * omits when the question does not call for it.
 *
 * Never throws. A report that cannot be written still downloads with its
 * figures, so every failure here is a degraded tier rather than an error.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

const draftStatementSchema = z.object({
  // A sentence naming run ids, scenario names and criteria inline routinely
  // runs past 400 characters without being verbose — this cap only needs to
  // rule out paragraphs, not ordinary citation-bearing prose.
  text: z.string().max(700).describe("One plain sentence. No markdown."),
  citations: z
    .array(citationSchema)
    .max(6)
    .describe(
      "Ids copied verbatim from EVIDENCE. Uncited sentences are discarded.",
    ),
});

const draftGroupSchema = z.object({
  name: z.string().max(80),
  mechanism: z
    .string()
    .max(400)
    .describe("What the agent did wrong, in terms of its behaviour."),
  signatureIds: z
    .array(z.string())
    .min(1)
    .describe("Group ids from EVIDENCE. Membership is expanded from these."),
  statements: z.array(draftStatementSchema).max(3).optional(),
});

const draftFindingSchema = z.object({
  headline: z.string().max(120),
  severity: z.enum(["critical", "high", "medium", "low"]),
  consequence: z
    .string()
    .max(200)
    .describe("What happens to someone using this agent if it ships."),
  statements: z.array(draftStatementSchema).max(4).optional(),
});

const draftArtifactSchema = z.object({
  artifactType: z.enum([
    "scenario",
    "system_prompt_amendment",
    "guardrail_rule",
  ]),
  title: z.string().max(80),
  rationale: z.string().max(300),
  body: z
    .string()
    .max(4000)
    .describe("Copy-pasteable as it stands. Nothing else."),
  statements: z.array(draftStatementSchema).max(3).optional(),
});

const draftAnswerSchema = z.object({
  questionId: z.string(),
  declined: z.boolean(),
  declinedReason: z.string().max(200).optional(),
  statements: z.array(draftStatementSchema).max(6).optional(),
  groups: z.array(draftGroupSchema).max(8).optional(),
  findings: z.array(draftFindingSchema).max(10).optional(),
  artifacts: z.array(draftArtifactSchema).max(6).optional(),
});

export const draftReportSchema = z.object({
  answers: z.array(draftAnswerSchema),
});

export type DraftReport = z.infer<typeof draftReportSchema>;
export type DraftAnswer = z.infer<typeof draftAnswerSchema>;

export interface NarrativeModel {
  resolve: () => Promise<Parameters<typeof generateObject>[0]["model"]>;
}

export async function runNarrativePass({
  evidenceBlock,
  questions,
  resolveModel,
  abortSignal,
}: {
  evidenceBlock: string;
  questions: QuestionDescriptor[];
  resolveModel: () => Promise<Parameters<typeof generateObject>[0]["model"]>;
  abortSignal?: AbortSignal;
}): Promise<DraftReport | null> {
  try {
    const model = await resolveModel();
    const { object } = await generateObject({
      model,
      schemaName: "RunReportDraft",
      schemaDescription:
        "One answer per question, each citing the evidence it rests on.",
      schema: draftReportSchema,
      system: buildNarrativeSystemPrompt({ questions }),
      prompt: `EVIDENCE\n\n${evidenceBlock}`,
      temperature: 0.2,
      abortSignal,
    });
    return object;
  } catch (error) {
    logger.warn({ error }, "Run report narrative pass failed; falling back");
    return null;
  }
}
