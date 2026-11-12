import { z } from "zod";

/** The bounds the experiment run API takes (`runInputsBodySchema` in the experiment contract). */
export const MAX_RUN_CONCURRENCY = 24;
export const MAX_RUN_REPEAT = 5;

/** The input of `platform_run_experiment`, the same fields and bounds as the run API body. */
export const runExperimentSchema = z.object({
  slug: z.string().describe("The experiment slug to run"),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(MAX_RUN_CONCURRENCY)
    .optional()
    .describe(
      "Cells (one row against one target) to run at once, for this run only (default: the server's setting). Use 1 to run them one at a time, in order.",
    ),
  repeat: z
    .number()
    .int()
    .min(1)
    .max(MAX_RUN_REPEAT)
    .optional()
    .describe(
      "How many times to run each dataset row against each target, a whole number from 1 to 5 (default 1). Use 3 or more to tell noise from real failures: a row that fails every time is a real failure, one that fails only some times is noise from the model. Run row `r * repeat + k` is repetition `k` of dataset row `r`, so platform_experiment_results lists every repetition and you count each dataset row's passes over its runs.",
    ),
});

export type RunExperimentParams = z.infer<typeof runExperimentSchema>;
