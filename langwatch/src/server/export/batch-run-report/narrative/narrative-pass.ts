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

/**
 * Every bound below is deliberately far above real output.
 *
 * `generateObject` validates the response as ONE object, so any cap here is
 * enforced by discarding the entire report — all eleven answers — rather than
 * the surplus. That makes a tight bound a trade of everything for nothing, and
 * it is not hypothetical: a six-citation cap lost a complete analysis to a
 * coverage sentence that named seven scenarios, and a 200-character cap lost
 * another to a declined answer whose one-sentence reason ran to 205.
 *
 * Length is a preference about readability. Correctness is enforced elsewhere
 * and does not depend on these numbers: citations are made safe by resolution,
 * which drops any id not in the evidence, and group membership is expanded from
 * the evidence rather than taken from the model. So these exist only to stop a
 * runaway response, and sit where a runaway is still caught and real prose is
 * never touched.
 */
const MAX_SENTENCE = 700;
const MAX_PARAGRAPH = 1_500;

const draftStatementSchema = z.object({
  text: z
    .string()
    .max(MAX_SENTENCE)
    .describe("One plain sentence. No markdown."),
  citations: z
    .array(citationSchema)
    .max(64)
    .describe(
      "Ids copied verbatim from EVIDENCE. Uncited sentences are discarded.",
    ),
});

const draftGroupSchema = z.object({
  name: z.string().max(200),
  mechanism: z
    .string()
    .max(MAX_PARAGRAPH)
    .describe("What the agent did wrong, in terms of its behaviour."),
  signatureIds: z
    .array(z.string())
    .min(1)
    .describe("Group ids from EVIDENCE. Membership is expanded from these."),
  statements: z.array(draftStatementSchema).max(8).optional(),
});

const draftFindingSchema = z.object({
  headline: z.string().max(300),
  severity: z.enum(["critical", "high", "medium", "low"]),
  consequence: z
    .string()
    .max(MAX_PARAGRAPH)
    .describe("What happens to someone using this agent if it ships."),
  statements: z.array(draftStatementSchema).max(8).optional(),
});

const draftArtifactSchema = z.object({
  artifactType: z.enum([
    "scenario",
    "system_prompt_amendment",
    "guardrail_rule",
  ]),
  title: z.string().max(200),
  rationale: z.string().max(MAX_PARAGRAPH),
  body: z
    .string()
    .max(20_000)
    .describe("Copy-pasteable as it stands. Nothing else."),
  statements: z.array(draftStatementSchema).max(8).optional(),
});

const draftAnswerSchema = z.object({
  questionId: z.string(),
  declined: z.boolean(),
  declinedReason: z.string().max(MAX_PARAGRAPH).optional(),
  statements: z.array(draftStatementSchema).max(16).optional(),
  groups: z.array(draftGroupSchema).max(48).optional(),
  findings: z.array(draftFindingSchema).max(32).optional(),
  artifacts: z.array(draftArtifactSchema).max(16).optional(),
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
