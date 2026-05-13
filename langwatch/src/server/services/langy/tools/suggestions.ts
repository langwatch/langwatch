import { z } from "zod";
import { defineLangyTool } from "../defineLangyTool";
import {
  langySuggestionActionSchema,
  type LangySuggestion,
} from "../suggestion";
import type { LangyConversationContext } from "./types";

const proposeSuggestionInputSchema = z.object({
  kind: z
    .string()
    .min(1)
    .describe(
      "Short kebab-case identifier for the *category* of nudge (e.g. 'rerun-stale-experiment', 'add-evaluator', 'open-failing-row'). The user can hide an entire kind via 'Don't show again'.",
    ),
  label: z
    .string()
    .min(1)
    .describe("One short line shown as the chip body. Imperative voice."),
  rationale: z
    .string()
    .min(1)
    .describe(
      "One short line of subtext under the label — why this might help.",
    ),
  action: langySuggestionActionSchema.describe(
    "What clicking the chip does — open_proposal | open_url | ask_followup.",
  ),
});

const suggestionAlreadyEmittedError = (kind: string) =>
  ({
    error: {
      code: "suggestion_limit_exceeded" as const,
      message:
        "Only one suggestion is allowed per turn. The current turn already emitted one.",
      kind,
    },
  }) as const;

const suggestionKindDismissedError = (kind: string) =>
  ({
    error: {
      code: "suggestion_kind_dismissed" as const,
      message:
        "The user has dismissed this kind of suggestion. Don't propose it again.",
      kind,
    },
  }) as const;

const suggestionToolOutputSchema = z.union([
  z.object({
    langySuggestion: z.literal(true),
    kind: z.string(),
    label: z.string(),
    rationale: z.string(),
    action: langySuggestionActionSchema,
  }),
  z.object({
    error: z.object({
      code: z.union([
        z.literal("suggestion_limit_exceeded"),
        z.literal("suggestion_kind_dismissed"),
      ]),
      message: z.string(),
      kind: z.string(),
    }),
  }),
]);

export function makeProposeSuggestion(ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "propose_suggestion",
    description:
      "Emit at most ONE post-turn suggestion chip with a follow-up action. Call this as the LAST step of your turn, only when there's a genuinely useful next step. Hard rules: max one call per turn; never call after the previous turn applied a proposal; never call when the user is troubleshooting an error; never call for a kind the user has dismissed.",
    inputSchema: proposeSuggestionInputSchema,
    outputSchema: suggestionToolOutputSchema,
    execute: async ({ kind, label, rationale, action }) => {
      const dismissed = ctx.dismissedSuggestionKinds ?? [];
      if (dismissed.includes(kind)) {
        return suggestionKindDismissedError(kind);
      }
      const tracker = ctx.suggestionEmissionTracker;
      if (tracker && tracker.count >= 1) {
        return suggestionAlreadyEmittedError(kind);
      }
      if (tracker) tracker.count += 1;
      const suggestion: LangySuggestion = {
        langySuggestion: true,
        kind,
        label,
        rationale,
        action,
      };
      return suggestion;
    },
  });
}
