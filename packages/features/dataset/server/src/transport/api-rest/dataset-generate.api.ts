/**
 * `POST /api/dataset/generate` — the dataset editor's row generator.
 *
 * A `handlerManagedAuth({ credential: "session" })` family: it resolves the
 * signed-in person itself and answers a bare `{ error }` at 401, 400 and 403,
 * which is the wire the editor reads. The session therefore arrives as a port
 * rather than through the framework's chain — the same shape the run export
 * and the studio doors use.
 *
 * What is generated is this feature's: the system prompt that caps a request
 * at thirty rows, the three row tools, and the UI-message stream the editor
 * applies optimistically. WHICH model answers is the deployment's cascade, so
 * the model handle arrives as a port.
 *
 * ORDERING is transcribed rather than tidied: the session is resolved BEFORE
 * the body is read, so a signed-out caller is refused without the request ever
 * being parsed, and `projectId` is checked before the permission probe it
 * would otherwise be run against.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  convertToModelMessages,
  smoothStream,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";

import { tools } from "./dataset-generate.tools";

const logger = createLogger("langwatch:api:dataset:generate");

/** The signed-in person this door reads. */
export type DatasetGenerateRestSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** The feature key the generator's model is resolved and priced on. */
export const DATASET_GENERATE_FEATURE_KEY = "datasets.generator";

/** What the row generator reaches that it does not own. */
export interface DatasetGenerateRestPorts<TSession extends DatasetGenerateRestSession> {
  /** The live session behind this request, or null when there is none. */
  resolveSession(request: Request): Promise<TSession | null>;
  /** Whether that session holds `datasets:manage` on the project. */
  probeProjectPermission(
    session: TSession,
    projectId: string,
    permission: "datasets:manage",
  ): Promise<boolean>;
  /** The model a feature key resolves to on this deployment. */
  resolveModel(input: { projectId: string; featureKey: string }): Promise<LanguageModel>;
}

const SYSTEM_PROMPT_PREFIX = `
You are a dataset generation assistant. You will be given a dataset, user instructions and a set of tools to use for adding, updating and deleting rows.

IMPORTANT: When the user asks you to add N rows (e.g., "add 10 examples"), you MUST call the addRow tool exactly N times - once for each row you're creating. Each addRow call adds ONE single row to the dataset.

If the user asks for more than 30 rows, generate only 30 rows and tell them you can only generate 30 rows at a time (it can go over 30 rows if the user asks for more on subsequent messages).
Keep calling the tools in sequence as many times as you need to to generate the dataset.
Keep the examples short and concise.

Current dataset:

`;

/** `/api/dataset/generate`, bound to one process. */
export function createDatasetGenerateRestApp<TSession extends DatasetGenerateRestSession>(options: {
  security: AppRestSecurity;
  ports: DatasetGenerateRestPorts<TSession>;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/dataset" });

  secured
    .access(
      handlerManagedAuth({
        reason: "user session validated in-handler via the process's session resolver",
        permissions: ["datasets:manage"],
        credential: "session",
      }),
    )
    .post("/generate", async (c) => {
      const session = await ports.resolveSession(c.req.raw);
      if (!session) {
        return c.json({ error: "You must be logged in to access this endpoint." }, 401);
      }

      const { messages, dataset, projectId } = (await c.req.json()) as {
        messages: UIMessage[];
        dataset: string;
        projectId: string;
      };

      if (!projectId) {
        return c.json({ error: "Missing projectId header" }, 400);
      }

      if (!(await ports.probeProjectPermission(session, projectId, "datasets:manage"))) {
        return c.json({ error: "You do not have permission to access this endpoint." }, 403);
      }

      messages.unshift({
        role: "system",
        parts: [{ type: "text", text: `${SYSTEM_PROMPT_PREFIX}${dataset}` }],
      } as UIMessage);

      const model = await ports.resolveModel({
        projectId,
        featureKey: DATASET_GENERATE_FEATURE_KEY,
      });
      const result = streamText({
        model,
        messages: await convertToModelMessages(messages),
        tools: tools(dataset),
        toolChoice: "required",
        maxOutputTokens: 4096 * 4,
        stopWhen: stepCountIs(50),
        experimental_transform: smoothStream({ chunking: "word" }),
        maxRetries: 3,
        onError: (error) => {
          logger.error({ error }, "error in streamtext");
        },
        providerOptions: { openai: { reasoningEffort: "low" } },
      });

      const response = result.toUIMessageStreamResponse();
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    });

  return secured.hono;
}
