import { z } from "zod";
import { llmConfigSchema, type LLMConfig } from "./dsl";

export const optimizerParamsSchema = z.object({
  llm: llmConfigSchema.optional().nullable(),
  num_candidates: z.number().optional(),
  max_bootstrapped_demos: z.number().optional(),
  max_labeled_demos: z.number().optional(),
  max_rounds: z.number().optional(),
  num_candidate_programs: z.number().optional(),
});

export const OPTIMIZERS = {
  MIPROv2ZeroShot: {
    name: "Prompt Only (MIPRO v2)",
    description:
      "Generates several prompt alternatives to try and improve the LLM performance.",
    minimum_train_set: 10,
    params: {
      llm: null as LLMConfig | null,
      num_candidates: 7,
    },
  },
  MIPROv2: {
    name: "Prompt + Demonstrations (MIPRO v2)",
    description:
      "Generates several prompt alternatives plus few shot examples (demonstrations) to try and improve the LLM performance.",
    minimum_train_set: 10,
    params: {
      llm: null as LLMConfig | null,
      num_candidates: 7,
      max_bootstrapped_demos: 4,
      max_labeled_demos: 16,
    },
  },
  BootstrapFewShotWithRandomSearch: {
    name: "Demonstrations Only (BootstrapFewShotWithRandomSearch)",
    description:
      "Generates several few shot examples (demonstrations) candidates and randomly searches to find the best.",
    minimum_train_set: 50,
    params: {
      max_bootstrapped_demos: 4,
      max_labeled_demos: 16,
      max_rounds: 1,
      num_candidate_programs: 10,
    },
  },
} satisfies Record<
  string,
  {
    name: string;
    description: string;
    minimum_train_set: number;
    params: z.infer<typeof optimizerParamsSchema>;
  }
>;
