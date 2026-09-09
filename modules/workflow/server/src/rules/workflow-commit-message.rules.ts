/**
 * The words the model is asked the question in. Pure: the caller brings the
 * normalised graph and the patch between two of them, this decides nothing
 * about how either was produced.
 */

/** The feature key a project resolves the commit-message model under. */
export const WORKFLOW_COMMIT_MESSAGE_FEATURE_KEY = "workflows.commit_message";

/** The name the patch header carries, so the diff reads as a file's. */
export const WORKFLOW_COMMIT_MESSAGE_PATCH_FILE = "workflow.json";

/** The two labels the patch header names its sides with. */
export const WORKFLOW_COMMIT_MESSAGE_PATCH_LABELS = {
  previous: "Previous Version",
  next: "New Version",
} as const;

/** One prompt, as the two messages the call is made with. */
export type WorkflowCommitMessagePrompt = Readonly<{
  system: string;
  user: string;
}>;

const SYSTEM = `
You are a diff generator for the LLM Workflow builder from LangWatch Optimization Studio.
Generate very short, concise commit messages for the changes in the diff. From 1 to 5 words max, all lowercase.
If changing the model, just say the short new model name, like "gpt-4o", nothing else.
For other changes:
- Ignore renames and position changes unless it's the only thing that changed.
- Explain not only the keys that changed, but the content inside them, for example do not say just "updated prompt", \
but the actual change that was made inside the fields with as few words as possible, like "avoid word <example>".
- By the way, always refer to the prompt as "prompt", not "instructions".
- When changing the evaluator, it's not just the name the changes, it means the workflow is actually now using a different evaluator.
- Do not use the word "edge", the user doesn't know the internal structure of the DSL, understand what is going on instead.
            `;

/** Assembles the prompt for one graph change. */
export function workflowCommitMessagePrompt(input: {
  previousDsl: string;
  diff: string;
}): WorkflowCommitMessagePrompt {
  return {
    system: SYSTEM,
    user: `
Original File:
\`\`\`json
${input.previousDsl}
\`\`\`

Diff:
\`\`\`diff
${input.diff}
\`\`\`
            `,
  };
}
