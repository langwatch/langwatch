import { generateObject, generateText, type CoreMessage } from "ai";
import { z } from "zod";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import {
  FIELD_VALUES,
  SEARCH_FIELDS,
  parse,
  validateAst,
  isEmptyAST,
} from "~/features/traces-v2/utils/queryParser";
import { QUERY_SYNTAX_DOC } from "~/features/traces-v2/searchSyntax/grammar";
import { getApp } from "~/server/app-layer/app";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:ai-query");

const MAX_ATTEMPTS = 3;
const DYNAMIC_VALUES_LIMIT = 20;

export interface AiQueryInput {
  projectId: string;
  prompt: string;
  timeRange: { from: number; to: number };
}

export type AiQueryResult =
  | { ok: true; query: string; attempts: number }
  | {
      ok: false;
      lastQuery: string;
      lastError: string;
      attempts: number;
    };

/**
 * The AI's higher-level surface — it can either apply a query to the
 * current view, or create a saved lens. The model picks the kind based
 * on the user's intent (phrases like "save as", "view for", "lens for"
 * lean toward `create_lens`; everything else toward `apply_query`).
 */
export type AiActionResult =
  | { ok: true; kind: "apply_query"; query: string }
  | {
      ok: true;
      kind: "create_lens";
      name: string;
      query: string;
    }
  | { ok: false; error: string };

const aiActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apply_query"),
    query: z
      .string()
      .describe(
        "The trace query language string to apply to the current view.",
      ),
  }),
  z.object({
    kind: z.literal("create_lens"),
    name: z
      .string()
      .min(1)
      .max(60)
      .describe(
        "Short human-readable lens name (1-3 words). Use Title Case.",
      ),
    query: z
      .string()
      .describe(
        "The locked filter query for the new lens (same syntax as apply_query).",
      ),
  }),
]);

/**
 * Translate a natural-language description into our trace query language.
 * Calls the project's default LLM with the grammar doc + a snapshot of
 * categorical values, then validates the output. If parse/validate fails,
 * loops up to `MAX_ATTEMPTS` times feeding the error back to the model.
 */
export async function generateTraceQueryFromPrompt(
  input: AiQueryInput,
): Promise<AiQueryResult> {
  const fieldsBlock = await buildFieldsBlock(input);
  const systemPrompt = buildSystemPrompt(fieldsBlock);
  const messages: CoreMessage[] = [{ role: "user", content: input.prompt }];

  const model = await getVercelAIModel(input.projectId);

  let lastQuery = "";
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { text } = await generateText({
      model,
      system: systemPrompt,
      messages,
      temperature: 0,
      maxRetries: 1,
    });
    lastQuery = sanitizeLlmOutput(text);

    const validation = validateQuery(lastQuery);
    if (validation.ok) {
      return { ok: true, query: lastQuery, attempts: attempt };
    }
    lastError = validation.error;
    logger.info(
      { projectId: input.projectId, attempt, lastError, lastQuery },
      "AI query failed validation, retrying",
    );
    messages.push({ role: "assistant", content: text });
    messages.push({
      role: "user",
      content: `That query failed to parse: ${validation.error}\n\nReturn a valid query. Output ONLY the query, with no quotes, no prose, no leading or trailing punctuation.`,
    });
  }

  return { ok: false, lastQuery, lastError, attempts: MAX_ATTEMPTS };
}

function validateQuery(
  query: string,
): { ok: true } | { ok: false; error: string } {
  if (!query) return { ok: false, error: "Empty query." };
  try {
    const ast = parse(query);
    if (isEmptyAST(ast)) return { ok: false, error: "Empty query." };
    const semanticError = validateAst(ast);
    if (semanticError) return { ok: false, error: semanticError };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown parse error.",
    };
  }
}

/**
 * Strip artifacts that LLMs often emit even when told not to: code fences,
 * leading "query:" labels, surrounding quotes, trailing periods.
 */
function sanitizeLlmOutput(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  out = out.replace(/^(?:query|filter|q)\s*[:=]\s*/i, "");
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

/**
 * Higher-level entry point: lets the model choose between just filtering
 * the current view (`apply_query`) and creating a named lens
 * (`create_lens`). Returns a structured action the frontend dispatches.
 *
 * Validates the embedded query the same way `generateTraceQueryFromPrompt`
 * does, retrying on parse failure.
 */
export async function generateTraceAction(
  input: AiQueryInput,
): Promise<AiActionResult> {
  const fieldsBlock = await buildFieldsBlock(input);
  const systemPrompt = buildActionSystemPrompt(fieldsBlock);

  const model = await getVercelAIModel(input.projectId);

  let lastError = "Unknown error";
  let lastQuery = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let parsedAction: z.infer<typeof aiActionSchema>;
    try {
      const { object } = await generateObject({
        model,
        system:
          attempt === 1
            ? systemPrompt
            : `${systemPrompt}\n\nThe previous attempt produced query "${lastQuery}" which failed to parse: ${lastError}\nReturn a valid query this time.`,
        schema: aiActionSchema,
        prompt: input.prompt,
        maxRetries: 1,
      });
      parsedAction = object;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Unknown generation error.";
      logger.info(
        { projectId: input.projectId, attempt, lastError },
        "AI action generation failed, retrying",
      );
      continue;
    }

    lastQuery = parsedAction.query;
    const validation = validateQuery(parsedAction.query);
    if (validation.ok) {
      return parsedAction.kind === "apply_query"
        ? { ok: true, kind: "apply_query", query: parsedAction.query }
        : {
            ok: true,
            kind: "create_lens",
            name: parsedAction.name,
            query: parsedAction.query,
          };
    }
    lastError = validation.error;
    logger.info(
      { projectId: input.projectId, attempt, lastError, lastQuery },
      "AI action query failed validation, retrying",
    );
  }

  return { ok: false, error: lastError };
}

function buildActionSystemPrompt(fieldsBlock: string): string {
  return `You translate natural-language descriptions into a trace-view action.

There are two action kinds you can return:

1. \`apply_query\` — apply a filter to the current view. This is the
   default for phrases like "show me errors", "find slow GPT-4 calls",
   "traces with feedback today".

2. \`create_lens\` — create a NEW saved lens (a named view) with this
   filter locked in. Use this when the user says "save as", "create a
   view for", "make a lens for", "I want a tab for…", or otherwise
   indicates they want a persistent view rather than a one-off filter.
   For \`create_lens\`, also produce a 1-3 word Title Case name.

Both kinds carry a \`query\` in the trace query language:

${QUERY_SYNTAX_DOC}

## Fields available (with sample values)

${fieldsBlock}

## Output rules

- Use uppercase AND, OR, NOT.
- Only use fields listed above.
- For value-side OR, group with parens, e.g. status:(error OR warning).
- For wildcards, use *.
- For numeric ranges, use [low TO high] or comparisons (>, >=, <, <=).
- If the user's intent is genuinely unclear, return \`apply_query\` with
  an empty query string — the caller will treat that as a no-op.`;
}

function buildSystemPrompt(fieldsBlock: string): string {
  return `You translate natural-language descriptions into our trace query language.

${QUERY_SYNTAX_DOC}

## Fields available (with sample values)

${fieldsBlock}

## Output rules

- Output ONLY the query string. No prose, no quotes, no labels, no code fences.
- Use uppercase AND, OR, NOT.
- Only use fields listed above.
- For value-side OR, group with parens, e.g. status:(error OR warning).
- For wildcards, use *.
- For numeric ranges, use [low TO high] or comparisons (>, >=, <, <=).
- If the user's intent is genuinely unclear, output an empty string.`;
}

async function buildFieldsBlock(input: AiQueryInput): Promise<string> {
  const dynamicValues = await fetchDynamicCategoricalValues(input);
  const lines: string[] = [];
  for (const [name, meta] of Object.entries(SEARCH_FIELDS)) {
    const sample = pickSampleValues(name, meta.facetField, dynamicValues);
    const sampleStr = sample.length > 0 ? ` — e.g. ${sample.join(", ")}` : "";
    lines.push(`- ${name} (${meta.valueType}): ${meta.label}${sampleStr}`);
  }
  return lines.join("\n");
}

function pickSampleValues(
  fieldName: string,
  facetField: string | undefined,
  dynamic: Map<string, string[]>,
): string[] {
  const fromDb = facetField ? dynamic.get(facetField) ?? [] : [];
  const fromStatic = FIELD_VALUES[fieldName] ?? [];
  const merged = Array.from(new Set([...fromDb, ...fromStatic])).slice(0, 8);
  return merged;
}

async function fetchDynamicCategoricalValues(
  input: AiQueryInput,
): Promise<Map<string, string[]>> {
  const app = getApp();
  const facetFields = Object.values(SEARCH_FIELDS)
    .filter((meta) => meta.valueType === "categorical" && meta.facetField)
    .map((meta) => meta.facetField as string);

  const results = await Promise.allSettled(
    facetFields.map((facetKey) =>
      app.traces.list.facetValues({
        tenantId: input.projectId,
        timeRange: input.timeRange,
        facetKey,
        limit: DYNAMIC_VALUES_LIMIT,
        offset: 0,
      }),
    ),
  );

  const map = new Map<string, string[]>();
  results.forEach((result, idx) => {
    const facetKey = facetFields[idx];
    if (!facetKey) return;
    if (result.status === "fulfilled") {
      map.set(
        facetKey,
        result.value.values.map((v) => v.value),
      );
    }
  });
  return map;
}
