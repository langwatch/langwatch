import { z } from "zod";

/** The author-assist model's structured output for one generated scenario. */
export const scenarioGenerateResultSchema = z.object({
  name: z.string().describe("A short, descriptive name for the scenario (3-6 words)"),
  situation: z
    .string()
    .describe(
      "The context and setup: user persona, emotional state, background, and what they're trying to accomplish",
    ),
  criteria: z
    .array(z.string())
    .describe("3-6 specific, observable success criteria that can be judged from the conversation"),
});

/** `POST /api/scenario/generate`'s request body. */
export const scenarioGenerateRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  currentScenario: z
    .object({
      name: z.string(),
      situation: z.string(),
      criteria: z.array(z.string()),
    })
    .nullable(),
  projectId: z.string().min(1, "Project ID is required"),
});
