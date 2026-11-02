import { z } from "zod";

/* A static import: the bundled prerender cannot read budgets.json beside its own module. */
import budgets from "../site/audit/budgets.json" with { type: "json" };

/** The named approximation: about four characters per token for English prose and code. */
export const TOKENISER = "characters / 4";

export function approximateTokens({ text }: { text: string }) {
  return Math.ceil(text.length / 4);
}

/** Approximate tokens (characters / 4) one page's Markdown export may hold. */
export const pageTokensSchema = z.number().int().positive();

/** The page token budget from budgets.json; a bad value fails the build. */
export const PAGE_TOKENS = z
  .object({ agentReadiness: z.object({ pageTokens: pageTokensSchema }) })
  .parse(budgets).agentReadiness.pageTokens;

/** Whether a page's Markdown export is within the agent readiness page token budget. */
export function fitsPageTokens({ markdown }: { markdown: string }) {
  return approximateTokens({ text: markdown }) <= PAGE_TOKENS;
}
