/**
 * Hono route for AI-powered scenario generation.
 *
 * Replaces POST /api/scenario/generate
 *
 * Uses the Vercel AI SDK to generate a structured scenario object
 * (name, situation, criteria) from a user prompt.
 */
import { generateObject, RetryError } from "ai";
import { z } from "zod";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { hasProjectPermission } from "~/server/api/rbac";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { nlpgoHandledErrorFrom } from "~/server/nlpgo/goHandledError";
import { createLogger } from "~/utils/logger/server";
import type { NextRequestShim as any } from "./types";

const logger = createLogger("langwatch:api:scenario:generate");

const scenarioSchema = z.object({
  name: z
    .string()
    .describe("A short, descriptive name for the scenario (3-6 words)"),
  situation: z
    .string()
    .describe(
      "The context and setup: user persona, emotional state, background, and what they're trying to accomplish",
    ),
  criteria: z
    .array(z.string())
    .describe(
      "3-6 specific, observable success criteria that can be judged from the conversation",
    ),
});

const requestSchema = z.object({
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

const SYSTEM_PROMPT = `You are a scenario generation assistant for LangWatch. Your job is to help users create behavioral test scenarios for their AI agents. You will respond with a JSON object containing the scenario details.

Given a description of an agent and desired scenario, generate:

1. **name**: A clear, concise name (3-6 words, e.g., "Angry refund request")

2. **situation**: A detailed context formatted with clear sections separated by blank lines:
   - User persona (who they are)
   - Emotional state (frustrated, confused, rushed, etc.)
   - Background context (what happened before)
   - What they're trying to accomplish

   Format the situation with labeled sections on separate lines, like:
   "User persona: [description]

   Emotional state: [description]

   Background: [description]

   Goal: [description]"

3. **criteria**: 3-6 success criteria that:
   - Are observable from the conversation
   - Test one specific behavior each
   - Use clear, judgeable language (e.g., "Agent must acknowledge the error" not "Agent is helpful")

When refining an existing scenario, incorporate the user's feedback while preserving the overall structure and any parts they haven't asked to change.`;

// Bound the LLM dispatch so a failing or slow gateway can't hold the request
// open long enough for a front reverse-proxy / ingress / CDN to give up and
// return its OWN html error page — which the browser then tries to JSON.parse,
// yielding the customer's `Unexpected token '<', "<!DOCTYPE "...` (langwatch#5758).
// The generate call routes through the same nlp-service /go/proxy path as the
// scenario User-Simulator, so when that gateway is misconfigured (e.g. the
// Azure "endpoint not set" bug fixed server-side by #5762) an UNBOUNDED call
// retried 3× (the AI SDK default) and burned ~6s per attempt-set before the
// app answered — plenty of time for an upstream proxy to substitute html.
// `maxRetries: 1` matches the sibling generateObject caller (ai-query.ts); the
// abort cap mirrors the gateway-call timeout in trace-api-span-query.ts. This
// does NOT make a broken gateway succeed (that's #5762) — it guarantees the
// endpoint always returns a fast, clean JSON envelope regardless of provider.
const SCENARIO_GENERATE_MAX_RETRIES = 1;
const SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS = 30_000;

// Read at call time (not module load) so ops can tune the cap without a deploy
// and the regression test can drive a real, fast abort against a hanging
// gateway — see scenario-generate.unit.test.ts. A non-positive/NaN override
// falls back to the default.
function scenarioGenerateTimeoutMs(): number {
  const override = Number(process.env.SCENARIO_GENERATE_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0
    ? override
    : SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS;
}

/**
 * True when `error` is (or wraps) an abort — the AbortSignal.timeout cap firing.
 * `AbortSignal.timeout().reason` is a `DOMException` (name "TimeoutError"), which
 * is NOT `instanceof Error` in this runtime, so match on the `name` property
 * directly. The AI SDK re-throws aborts unwrapped, but unwrap an exhausted-retry
 * `RetryError` too so a wrapped abort still maps to the clean 504.
 */
function isAbortLikeError(error: unknown): boolean {
  const root =
    RetryError.isInstance(error) && error.lastError ? error.lastError : error;
  const name = (root as { name?: unknown } | null | undefined)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

const secured = createServiceApp({ basePath: "/api/scenario" });

secured.access(
  handlerManagedAuth("user session validated in-handler via getServerAuthSession"),
).post("/generate", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session) {
    return c.json(
      { error: "You must be logged in to access this endpoint." },
      { status: 401 },
    );
  }

  let body;
  try {
    body = requestSchema.parse(await c.req.json());
  } catch (error) {
    logger.error({ error }, "Invalid request body");
    return c.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { prompt, currentScenario, projectId } = body;

  const hasPermission = await hasProjectPermission(
    { prisma, session },
    projectId,
    "scenarios:manage",
  );
  if (!hasPermission) {
    return c.json(
      { error: "You do not have permission to access this endpoint." },
      { status: 403 },
    );
  }

  try {
    const model = await getVercelAIModel({ projectId, featureKey: "scenarios.generator" });

    const userPrompt = currentScenario
      ? `Current scenario:\n${JSON.stringify(currentScenario, null, 2)}\n\nUser request: ${prompt}`
      : prompt;

    const result = await generateObject({
      model,
      schema: scenarioSchema,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      maxRetries: SCENARIO_GENERATE_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(scenarioGenerateTimeoutMs()),
    });

    return c.json({ scenario: result.object });
  } catch (error) {
    // Handled Go-side failures (nlpgo / AI Gateway) arrive as a typed
    // envelope on the AI SDK error — forward them with their kind so
    // the browser can react (e.g. missing_provider → settings link).
    const handled = nlpgoHandledErrorFrom(error);
    if (handled) {
      logger.warn(
        { error: handled.serialize() },
        "Scenario generation rejected by LLM gateway",
      );
      return c.json(
        { error: handled.message, domainError: handled.serialize() },
        { status: handled.httpStatus as 400 },
      );
    }

    // The abort cap fired (slow/hung gateway). Answer with a clean, fast
    // JSON envelope instead of leaving the request open for an upstream
    // proxy to fill with an html timeout page (langwatch#5758).
    if (isAbortLikeError(error)) {
      logger.warn({ error }, "Scenario generation timed out");
      return c.json(
        {
          error:
            "Scenario generation took too long and was stopped. This is usually temporary — please try again in a moment.",
        },
        { status: 504 },
      );
    }

    logger.error({ error }, "Error generating scenario");

    const errorMessage =
      error instanceof Error ? error.message : "Failed to generate scenario";

    return c.json({ error: errorMessage }, { status: 500 });
  }
});

export const app = secured.hono;
