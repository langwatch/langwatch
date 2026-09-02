/**
 * `POST /api/scenario/generate` — the scenario editor's author-assist.
 *
 * A `handlerManagedAuth({ credential: "session" })` family: it resolves the
 * signed-in person itself and answers a bare `{ error }` at 401, 400 and 403.
 * The session arrives as a port for that reason, the same as the sibling
 * generators.
 *
 * Three of its five answers exist because of one incident, and they are
 * transcribed rather than reshaped:
 *
 *  - the generation is capped by `AbortSignal.timeout` and answers **504**
 *    when the cap fires, so a hung gateway can never hold the request open
 *    long enough for a front proxy to substitute its own HTML error page —
 *    which the browser then tries to `JSON.parse` (langwatch#5758);
 *  - `maxRetries` is **1**, not the SDK's 3, because three unbounded attempts
 *    were what made that window wide enough to reach;
 *  - a refusal the Go engine names arrives as a handled envelope and is
 *    forwarded with its CODE and serialized form, never its message — the
 *    browser keys its own copy off `error.code` (ADR-045).
 *
 * The timeout is read at call time rather than at module load so a test can
 * drive a real abort without waiting thirty seconds for one.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import { isAbortLikeError, nlpgoHandledErrorFrom } from "./scenario-generate.nlpgo-error";

const logger = createLogger("langwatch:api:scenario:generate");

/** The signed-in person this door reads. */
export type ScenarioGenerateRestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** The feature key the author-assist's model is resolved and priced on. */
export const SCENARIO_GENERATE_FEATURE_KEY = "scenarios.generator";

/** What the author-assist reaches that it does not own. */
export interface ScenarioGenerateRestPorts<TSession extends ScenarioGenerateRestSession> {
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `scenarios:manage` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: "scenarios:manage",
  ): Promise<boolean>;
  /** The model a feature key resolves to on this deployment. */
  resolveModel(input: { projectId: string; featureKey: string }): Promise<LanguageModel>;
  /**
   * How long one generation may run before it is aborted, in milliseconds.
   *
   * A port because the cap is what keeps a hung gateway from reaching the
   * front proxy's timeout, and that budget belongs to the deployment.
   */
  timeoutMs(): number;
}

/** The generation's own default cap; a process may state a different one. */
export const SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS = 30_000;

const SCENARIO_GENERATE_MAX_RETRIES = 1;

const scenarioSchema = z.object({
  name: z.string().describe("A short, descriptive name for the scenario (3-6 words)"),
  situation: z
    .string()
    .describe(
      "The context and setup: user persona, emotional state, background, and what they're trying to accomplish",
    ),
  criteria: z
    .array(z.string())
    .describe("3-6 specific, observable success criteria that can be judged from the conversation"),
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

/** `/api/scenario/generate`, bound to one process. */
export function createScenarioGenerateRestApp<TSession extends ScenarioGenerateRestSession>(options: {
  security: AppRestSecurity;
  ports: ScenarioGenerateRestPorts<TSession>;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/scenario" });

  secured
    .access(
      handlerManagedAuth({
        reason: "user session validated in-handler via the process's session resolver",
        permissions: ["scenarios:manage"],
        credential: "session",
      }),
    )
    .post("/generate", async (c) => {
      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        return c.json({ error: "You must be logged in to access this endpoint." }, 401);
      }

      let body: z.infer<typeof requestSchema>;
      try {
        body = requestSchema.parse(await c.req.json());
      } catch (error) {
        logger.error({ error }, "Invalid request body");
        return c.json({ error: "Invalid request body" }, 400);
      }

      const { prompt, currentScenario, projectId } = body;

      if (!(await ports.probeProjectPermission(session, projectId, "scenarios:manage"))) {
        return c.json({ error: "You do not have permission to access this endpoint." }, 403);
      }

      try {
        const model = await ports.resolveModel({
          projectId,
          featureKey: SCENARIO_GENERATE_FEATURE_KEY,
        });

        const userPrompt = currentScenario
          ? `Current scenario:\n${JSON.stringify(currentScenario, null, 2)}\n\nUser request: ${prompt}`
          : prompt;

        const result = await generateObject({
          model,
          schema: scenarioSchema,
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          maxRetries: SCENARIO_GENERATE_MAX_RETRIES,
          abortSignal: AbortSignal.timeout(ports.timeoutMs()),
        });

        return c.json({ scenario: result.object });
      } catch (error) {
        // A refusal the Go engine named arrives as a typed envelope on the AI
        // SDK error. Forward the CODE and the serialized form — the message is
        // server copy and stays server-side.
        const handled = nlpgoHandledErrorFrom(error);
        if (handled) {
          logger.warn(
            { error: handled.serialize() },
            "Scenario generation rejected by LLM gateway",
          );
          return c.json(
            { error: handled.code, domainError: handled.serialize() },
            handled.httpStatus as 400,
          );
        }

        if (isAbortLikeError(error)) {
          logger.warn({ error }, "Scenario generation timed out");
          return c.json(
            {
              error:
                "Scenario generation took too long and was stopped. This is usually temporary — please try again in a moment.",
            },
            504,
          );
        }

        logger.error({ error }, "Error generating scenario");
        return c.json(
          { error: error instanceof Error ? error.message : "Failed to generate scenario" },
          500,
        );
      }
    });

  return secured.hono;
}
