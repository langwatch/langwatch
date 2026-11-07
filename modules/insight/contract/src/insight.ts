import type { Named } from "@langwatch/module";
import { z } from "zod";

/** Langy's verdict on the news, written out on the card rather than left to a colour. */
export const INSIGHT_TONES = ["bad", "watch", "good"] as const;
export const insightToneSchema = z.enum(INSIGHT_TONES);
export type InsightTone = z.infer<typeof insightToneSchema>;

export const insightTitleSchema = z.string().trim().min(1).max(200);
/** Markdown-lite: paragraphs split on blank lines, a paragraph of only `**Header**` is a header. */
export const insightBodySchema = z.string().trim().min(1).max(20_000);
/** One word, shown as a chip, like an email label. */
export const insightTopicSchema = z.string().trim().min(1).max(40);
/** How many days the insight is expected to stay true before it drops to Stale. */
export const insightValidDaysSchema = z.number().int().min(1).max(90);
export const DEFAULT_INSIGHT_VALID_DAYS = 7;

/** The Langy answer an insight was saved from, so "Chat about it" can find its way back. */
const insightSourceSchemaDefinition = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
});
export interface InsightSourceSchema extends Named<typeof insightSourceSchemaDefinition> {}
export const insightSourceSchema: InsightSourceSchema = insightSourceSchemaDefinition;
export type InsightSource = z.infer<typeof insightSourceSchema>;

/** How an insight was filed: a person saving a Langy answer, or a scheduled run. */
export const INSIGHT_FILED_VIA = ["chat", "run"] as const;
export const insightFiledViaSchema = z.enum(INSIGHT_FILED_VIA);
export type InsightFiledVia = z.infer<typeof insightFiledViaSchema>;

const pointerIdSchema = z.string().min(1).max(200);
const pointerNameSchema = z.string().trim().min(1).max(200);

/**
 * The board and widget an insight came from. Only a pointer: nothing checks that either
 * exists, and the names are kept as filed, so the card still says where it came from once
 * the board or the widget is gone.
 */
const insightBoardSchemaDefinition = z.object({
  id: pointerIdSchema,
  name: pointerNameSchema,
  widget: z.object({ id: pointerIdSchema, name: pointerNameSchema }).nullable(),
});
export interface InsightBoardSchema extends Named<typeof insightBoardSchemaDefinition> {}
export const insightBoardSchema: InsightBoardSchema = insightBoardSchemaDefinition;
export type InsightBoard = z.infer<typeof insightBoardSchema>;

const MAX_REPLAY_PARAMETERS = 32;
const replayParameterValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
]);

/**
 * The evidence, kept as what to run and never as results: the fixed window the query read
 * and the values in force when the insight was filed. A relative period would slide, and
 * the chart would stop matching the text.
 */
const insightReplaySchemaDefinition = z
  .object({
    /** Epoch milliseconds. The window is half-open: `[start, end)`. */
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    /** The datapoint step the query read with, in seconds. */
    granularitySeconds: z.number().int().positive(),
    /** The board's period as it was set ("Last 30 days"), for the line under the chart. */
    period: z.string().trim().min(1).max(80).nullable(),
    /** The query's named parameter values; empty when it takes none. */
    parameters: z
      .record(z.string().min(1).max(64), replayParameterValueSchema)
      .refine((parameters) => Object.keys(parameters).length <= MAX_REPLAY_PARAMETERS, {
        error: `At most ${MAX_REPLAY_PARAMETERS} parameter values are kept with an insight`,
      }),
  })
  .refine(({ start, end }) => end > start, {
    path: ["end"],
    error: "The window must end after it starts",
  });
export interface InsightReplaySchema extends Named<typeof insightReplaySchemaDefinition> {}
export const insightReplaySchema: InsightReplaySchema = insightReplaySchemaDefinition;
export type InsightReplay = z.infer<typeof insightReplaySchema>;

/** At most this many actions ride on one insight. */
export const MAX_INSIGHT_ACTIONS = 4;

/** The hosts a link in an action may name; any other web address refuses the action. */
export const INSIGHT_ACTION_LINK_HOSTS = ["langwatch.ai", "app.langwatch.ai"] as const;

const ALLOWED_LINK_HOSTS: ReadonlySet<string> = new Set(INSIGHT_ACTION_LINK_HOSTS);
const WEB_SCHEMES: ReadonlySet<string> = new Set(["http", "https"]);

const REFUSED_SCHEME_NAMES = ["javascript", "data", "vbscript", "file", "mailto", "ftp"];
/**
 * Refused whatever follows, from a word's start: `metadata:x`, `trace.data:x`, `meta-data:x`,
 * `span/data:x` and `user_data:x` stay words. A browser drops a tab, so one may split the scheme.
 */
const REFUSED_SCHEME = new RegExp(
  `(?<![\\p{L}\\p{N}._/-])(?:${REFUSED_SCHEME_NAMES.map((name) => name.split("").join("\\t*")).join("|")})\\t*:\\t*\\S`,
  "iu",
);
/**
 * Any scheme before two slashes. No word start: a scheme past the bound still matches by its tail.
 * One slash is words: `path:/api/v1`, `C:/Users/x`. `http(s):/x` is left to the address scan.
 */
const SCHEME_BEFORE_SLASH = /([a-z][a-z0-9+.-]{0,31}):[/\\]{2}/gi;
/**
 * `http(s):`, `www.`, `host/path` with a common ending, or `//` at a word's start or after `(<[:`
 * or a quote (`:` catches `_https://x`, which `\b` misses), to the next whitespace or `http(s):`. A
 * tab or line break a browser would drop goes to `continued`. `trace.cost/day`, `a//b` are words.
 */
const WEB_ADDRESS =
  /(?:\bhttps?:(?=[\S\t])|(?<![^\s(<["'`:])[/\\]{2}\S|\bwww\.|(?:[\p{L}\p{N}-]{1,63}\.){1,8}(?:com|net|org|io|ai|co|dev|app|xyz|info)(?::\d{1,5})?[/\\])(?:(?!https?:)\S)*(?<continued>\t|\n[\t\n]*(?:[.@/\\:]|[\p{L}\p{N}-]{1,63}\.\p{L}))?/giu;
const HTTP_AND_SLASHES = /^(?:https?:)?\/*/i;
const SENTENCE_END = /[.,;:!?)\]}>"'`*]{1,32}$/;

/** Read without tabs, which a browser drops: `evil<TAB>scheme://x` is `evilscheme://x`. */
function namesRefusedScheme(words: string): boolean {
  return (
    REFUSED_SCHEME.test(words) ||
    [...words.replaceAll("\t", "").matchAll(SCHEME_BEFORE_SLASH)].some(
      ([, scheme = ""]) => !WEB_SCHEMES.has(scheme.toLowerCase()),
    )
  );
}

/** The host a browser would go to: after any `user@`, before any port, path, query or fragment. */
function hostOf(address: string): string {
  const authority = address.replace(HTTP_AND_SLASHES, "").split(/[/?#]/, 1)[0] ?? "";
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.replace(/:\d*$/, "").toLowerCase();
}

/** A browser reads a backslash as a slash or inside a name, by scheme, so none is allowed. */
function isAllowedLink(address: string): boolean {
  const link = address.replace(SENTENCE_END, "");
  return !link.includes("\\") && ALLOWED_LINK_HOSTS.has(hostOf(link));
}

/** No refused scheme, and every web address the words name points at an allowed host. */
function namesOnlyAllowedLinks(words: string): boolean {
  if (namesRefusedScheme(words)) return false;
  return [...words.matchAll(WEB_ADDRESS)].every(
    ({ 0: address, groups }) => !groups?.continued && isAllowedLink(address),
  );
}

const NOT_ALLOWED_LINK = "A link in an action may only point at langwatch.ai";
/** `.max()` alone does not stop a later `.refine()`, which would scan the whole oversize field. */
const STOP_AT_THE_CAP = { abort: true };

const insightActionLabelSchema = z
  .string()
  .overwrite((label) => label.replaceAll(/[\p{Cc}\p{Cf}]/gu, ""))
  .trim()
  .min(1)
  .max(40, STOP_AT_THE_CAP)
  .refine(namesOnlyAllowedLinks, { error: NOT_ALLOWED_LINK });

/**
 * A prompt keeps its line breaks and tabs; every other control character is dropped, and every
 * invisible format character, which could hide a link from this check and bidi-flip the card.
 */
const insightActionPromptSchema = z
  .string()
  .overwrite((prompt) => prompt.replaceAll(/[^\P{Cc}\n\t]|\p{Cf}/gu, ""))
  .trim()
  .min(1)
  .max(1_000, STOP_AT_THE_CAP)
  .refine(namesOnlyAllowedLinks, { error: NOT_ALLOWED_LINK });

/**
 * An action Langy proposes for an insight, as a filing hands it over: a button label and the
 * prompt a click sends to Langy. The prompt is shown before the click and sent word for word.
 */
const insightActionInputSchemaDefinition = z.object({
  label: insightActionLabelSchema,
  prompt: insightActionPromptSchema,
});
export interface InsightActionInputSchema extends Named<
  typeof insightActionInputSchemaDefinition
> {}
export const insightActionInputSchema: InsightActionInputSchema =
  insightActionInputSchemaDefinition;
export type InsightActionInput = z.infer<typeof insightActionInputSchema>;

/** A stored action: its id is minted by the module at filing (`a0`..`a3`, by position). */
const insightActionSchemaDefinition = z.object({
  id: z.string().min(1).max(8),
  label: z.string().min(1).max(40),
  prompt: z.string().min(1).max(1_000),
});
export interface InsightActionSchema extends Named<typeof insightActionSchemaDefinition> {}
export const insightActionSchema: InsightActionSchema = insightActionSchemaDefinition;
export type InsightAction = z.infer<typeof insightActionSchema>;

/** One insight as its owner sees it: the record plus their own seen, done and kept state. */
const insightEntrySchemaDefinition = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tone: insightToneSchema,
  topic: z.string().nullable(),
  validDays: z.number().int(),
  /** The LangWatchQL query behind the insight, its evidence. */
  lwql: z.string().nullable(),
  /** The fixed window and values `lwql` replays with; null when it was filed without one. */
  replay: insightReplaySchema.nullable(),
  source: insightSourceSchema.nullable(),
  board: insightBoardSchema.nullable(),
  filedVia: insightFiledViaSchema,
  /** Whose insight it is: the one person who reads it. Null only where nobody can. */
  ownerUserId: z.string().nullable(),
  filedByUserId: z.string().nullable(),
  /** The key a daily run matches a repeated finding by; null when it was saved from a chat. */
  findingKey: z.string().nullable(),
  /** What a click sends to Langy; none on an insight a run filed. */
  actions: z.array(insightActionSchema),
  /** Epoch milliseconds. */
  filedAt: z.number(),
  /** When a later run last found it still true; null until one did. */
  renewedAt: z.number().nullable(),
  seenAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  keptAt: z.number().nullable(),
});
export interface InsightEntrySchema extends Named<typeof insightEntrySchemaDefinition> {}
export const insightEntrySchema: InsightEntrySchema = insightEntrySchemaDefinition;
export type InsightEntry = z.infer<typeof insightEntrySchema>;

const insightProjectScopeSchemaDefinition = z.object({ projectId: z.string().min(1) });
export interface InsightProjectScopeSchema extends Named<
  typeof insightProjectScopeSchemaDefinition
> {}
export const insightProjectScopeSchema: InsightProjectScopeSchema =
  insightProjectScopeSchemaDefinition;

const fileInsightInputSchemaDefinition = z
  .object({
    ...insightProjectScopeSchema.shape,
    title: insightTitleSchema,
    body: insightBodySchema,
    tone: insightToneSchema,
    topic: insightTopicSchema.optional(),
    validDays: insightValidDaysSchema.default(DEFAULT_INSIGHT_VALID_DAYS),
    lwql: z.string().trim().min(1).max(20_000).optional(),
    replay: insightReplaySchema.optional(),
    source: insightSourceSchema.optional(),
    board: insightBoardSchema.optional(),
    /** None when left out; dropped when the source conversation is a run's. */
    actions: z.array(insightActionInputSchema).max(MAX_INSIGHT_ACTIONS).optional(),
  })
  .refine(({ lwql, replay }) => replay === undefined || lwql !== undefined, {
    path: ["replay"],
    error: "A window needs the query it replays",
  });
export interface FileInsightInputSchema extends Named<typeof fileInsightInputSchemaDefinition> {}
export const fileInsightInputSchema: FileInsightInputSchema = fileInsightInputSchemaDefinition;
export type FileInsightInput = z.infer<typeof fileInsightInputSchema>;

const insightScopeSchemaDefinition = z.object({
  ...insightProjectScopeSchema.shape,
  insightId: z.string().min(1),
});
export interface InsightScopeSchema extends Named<typeof insightScopeSchemaDefinition> {}
export const insightScopeSchema: InsightScopeSchema = insightScopeSchemaDefinition;
export type InsightScope = z.infer<typeof insightScopeSchema>;

/** A folder visit marks what it shows; capped so one call stays one small batch. */
const markInsightsSeenInputSchemaDefinition = z.object({
  ...insightProjectScopeSchema.shape,
  insightIds: z.array(z.string().min(1)).min(1).max(200),
});
export interface MarkInsightsSeenInputSchema extends Named<
  typeof markInsightsSeenInputSchemaDefinition
> {}
export const markInsightsSeenInputSchema: MarkInsightsSeenInputSchema =
  markInsightsSeenInputSchemaDefinition;
export type MarkInsightsSeenInput = z.infer<typeof markInsightsSeenInputSchema>;

/**
 * One click on an action. `clickId` is minted by the browser per click, so a repeated request of
 * the same click sends Langy nothing new. The prompt is never sent: the module reads it.
 */
const runInsightActionInputSchemaDefinition = z.object({
  ...insightScopeSchema.shape,
  actionId: z.string().min(1).max(8),
  clickId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export interface RunInsightActionInputSchema extends Named<
  typeof runInsightActionInputSchemaDefinition
> {}
export const runInsightActionInputSchema: RunInsightActionInputSchema =
  runInsightActionInputSchemaDefinition;
export type RunInsightActionInput = z.infer<typeof runInsightActionInputSchema>;

/** The Langy turn a click started, and why it is in a new conversation when it is one. */
const insightActionRunSchemaDefinition = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  /** The source conversation can no longer be read. */
  sourceGone: z.boolean(),
  /** The source still exists, but the clicker's copy of it did not get ready in time. */
  forkNotReady: z.boolean(),
  /** What that unused copy is called, as it may still appear in their list; null otherwise. */
  forkTitle: z.string().nullable(),
});
export interface InsightActionRunSchema extends Named<typeof insightActionRunSchemaDefinition> {}
export const insightActionRunSchema: InsightActionRunSchema = insightActionRunSchemaDefinition;
export type InsightActionRun = z.infer<typeof insightActionRunSchema>;
