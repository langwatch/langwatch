/**
 * leaderboardExplanation — puts an already-decided comparison result into
 * words, on request.
 *
 * The important property of this endpoint is what it is NOT given. It never
 * sees the raw run: not the per-row verdicts, not the candidate outputs, not
 * the win matrix. It receives the finished numbers — the verdict the client
 * already computed and is already displaying, the scores with their
 * intervals, the costs, and the trust checks — and is asked to explain them.
 *
 * That is a structural guarantee, not a prompt instruction. A model handed
 * the raw comparisons could re-derive a different winner and state it
 * fluently, and fluent wrong answers in an analytics surface are acted on:
 * plain English reads as authority, which is precisely why the load-bearing
 * sentence (formatLeaderboardHeadline) is computed in code and rendered
 * ABOVE whatever comes back from here. Nothing this endpoint returns can
 * change the verdict on screen.
 *
 * Runs on the FAST model role. It is paraphrasing arithmetic someone else
 * did, so a cheap model is the right trade — and the workspace picks which
 * one via the standard per-feature model resolution.
 */
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { z } from "zod";

import { prisma } from "../../db";
import { wrapAiCall } from "../../modelProviders/aiCallFailedError";
import { featureByKey } from "../../modelProviders/featureRegistry";
import { resolveModelForFeature } from "../../modelProviders/resolveModelForFeature";
import { getVercelAIModel } from "../../modelProviders/utils";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:leaderboard-explanation");

export const LEADERBOARD_SUMMARY_FEATURE_KEY =
  "experiments.leaderboard_summary";

/**
 * The computed facts, and only the computed facts. Bounded lengths and
 * counts so a crafted payload cannot turn this into an open-ended prompt
 * relay against the workspace's own model credentials.
 */
const explanationFactsSchema = z.object({
  verdictKind: z.enum(["clear-winner", "tie-at-top", "no-signal"]),
  /** The sentence already on screen. The model must not contradict it. */
  headline: z.string().max(400),
  headlineDetail: z.string().max(600),
  comparisonCount: z.number().int().min(0),
  separatedPairs: z.number().int().min(0),
  totalPairs: z.number().int().min(0),
  entries: z
    .array(
      z.object({
        name: z.string().max(120),
        score: z.number(),
        ciLow: z.number().nullable(),
        ciHigh: z.number().nullable(),
        winRate: z.number().nullable(),
        matchups: z.number().int().min(0),
        degenerate: z.boolean(),
        avgCost: z.number().nullable(),
        avgDurationMs: z.number().nullable(),
      }),
    )
    .max(30),
  checks: z
    .array(
      z.object({
        label: z.string().max(120),
        detail: z.string().max(600),
        tone: z.enum(["ok", "warn", "note"]),
      }),
    )
    .max(20),
});

export type LeaderboardExplanationFacts = z.infer<
  typeof explanationFactsSchema
>;

const formatNumber = (value: number | null, digits = 0): string =>
  value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);

const formatCost = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? "—"
    : value >= 0.01
      ? `$${value.toFixed(2)}`
      : `$${value.toFixed(4)}`;

/**
 * Renders the facts as a compact table. Deliberately pre-formatted rather
 * than handed over as JSON: the model's job is to narrate these exact
 * figures, and giving it the already-rounded strings removes any room to
 * "helpfully" recompute one into a different number than the reader sees on
 * the chart beside it.
 */
export const buildExplanationPrompt = (
  facts: LeaderboardExplanationFacts,
): string => {
  const rows = facts.entries
    .map(
      (e) =>
        `- ${e.name}: score ${formatNumber(e.score)} ` +
        `(plausible range ${formatNumber(e.ciLow)} to ${formatNumber(e.ciHigh)}), ` +
        `win rate ${e.winRate === null ? "—" : `${Math.round(e.winRate * 100)}%`} ` +
        `over ${e.matchups} comparisons, ` +
        `average cost ${formatCost(e.avgCost)} per row, ` +
        `average latency ${formatNumber(e.avgDurationMs)}ms` +
        (e.degenerate ? " (never won or never lost, so unrankable)" : ""),
    )
    .join("\n");

  const checks = facts.checks
    .map((c) => `- [${c.tone}] ${c.label}: ${c.detail}`)
    .join("\n");

  return [
    "You are explaining a finished A/B/n comparison of AI prompt variants to a product manager or engineer who has to decide which one to ship.",
    "",
    "The result below has ALREADY been computed and is already displayed to them. Your job is to explain it, not to reach it.",
    "",
    "## The conclusion already shown to the reader",
    facts.headline,
    facts.headlineDetail,
    "",
    "## Ranking (Bradley-Terry scores from head-to-head judge verdicts)",
    rows || "- (no rankable variants)",
    "",
    `## Confidence: ${facts.separatedPairs} of ${facts.totalPairs} variant pairs were separated beyond their margins of error, across ${facts.comparisonCount} comparisons.`,
    "",
    "## Checks that were run",
    checks || "- (none)",
    "",
    "## Rules",
    "- Do NOT name a different winner than the conclusion above, and do not soften a tie into a winner or harden a winner into a tie.",
    "- Two variants whose plausible ranges overlap are NOT distinguishable. Never describe one as better than the other.",
    "- Only use the numbers given. Do not estimate, extrapolate, or invent any figure, and do not predict how many more rows would settle anything.",
    "- If a check is flagged, say plainly what it means for acting on this result.",
    "- Write 2 to 4 short sentences of plain prose. No headings, no bullet points, no markdown, no preamble.",
    "- Address the reader as 'you'. Be concrete about the trade-off they are actually making.",
  ].join("\n");
};

export const leaderboardExplanationRouter = createTRPCRouter({
  explain: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        facts: explanationFactsSchema,
      }),
    )
    // The facts come from a run the caller is already looking at, so gate on
    // the same permission that let them open it. Anything stricter would put
    // an action in front of read-only members that then 403s.
    .use(checkProjectPermission("experiments:view"))
    .mutation(async ({ input }) => {
      const feature = featureByKey(LEADERBOARD_SUMMARY_FEATURE_KEY);
      if (!feature) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${LEADERBOARD_SUMMARY_FEATURE_KEY} feature is not registered`,
        });
      }

      // Resolved outside wrapAiCall so ModelNotConfiguredError and
      // ModelProviderDisabledError reach handledErrorMiddleware with their
      // types intact and open their own toasts — same reasoning as
      // translate.ts, where collapsing them into AI_CALL_FAILED left the
      // user with a generic "try again" for a configuration problem.
      const resolution = await resolveModelForFeature(
        LEADERBOARD_SUMMARY_FEATURE_KEY,
        { prisma, projectId: input.projectId },
      );
      const model = await getVercelAIModel({
        projectId: input.projectId,
        featureKey: LEADERBOARD_SUMMARY_FEATURE_KEY,
      });

      const { text } = await wrapAiCall(feature, async () => {
        try {
          return await generateText({
            model,
            prompt: buildExplanationPrompt(input.facts),
          });
        } catch (error) {
          logger.error(
            { error, projectId: input.projectId },
            "Leaderboard explanation model call failed",
          );
          throw error;
        }
      });

      // The model is named back to the caller so the explanation is
      // attributable. An unattributed paragraph beside a computed chart
      // reads as part of the analysis rather than as generated text.
      return { explanation: text.trim(), model: resolution.model };
    }),
});
