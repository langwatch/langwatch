import { z } from "zod";

export const SUGGESTION_MARKER = "langySuggestion" as const;

const openProposalActionSchema = z.object({
  type: z.literal("open_proposal"),
  proposalId: z.string().min(1),
});

const openUrlActionSchema = z.object({
  type: z.literal("open_url"),
  href: z.string().min(1),
});

const askFollowupActionSchema = z.object({
  type: z.literal("ask_followup"),
  prompt: z.string().min(1),
});

export const langySuggestionActionSchema = z.discriminatedUnion("type", [
  openProposalActionSchema,
  openUrlActionSchema,
  askFollowupActionSchema,
]);

export const langySuggestionSchema = z.object({
  langySuggestion: z.literal(true),
  kind: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1),
  action: langySuggestionActionSchema,
});

export type LangySuggestionAction = z.infer<typeof langySuggestionActionSchema>;
export type LangySuggestion = z.infer<typeof langySuggestionSchema>;

export function isLangySuggestion(value: unknown): value is LangySuggestion {
  return langySuggestionSchema.safeParse(value).success;
}
