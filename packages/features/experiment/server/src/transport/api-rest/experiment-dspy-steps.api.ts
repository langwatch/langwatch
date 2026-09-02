/**
 * `POST /api/dspy/log_steps` — the DSPy optimizer's own progress log.
 *
 * A run posts each batch of steps as it finishes; the app renders them as the
 * run's score curve. It resolves the experiment through the SAME
 * {@link ExperimentFindOrCreateService} `/api/experiment/init` and the batch
 * result log resolve theirs, so an optimizer that initialised a run through
 * one door and reports through this one writes into one experiment.
 *
 * ## Why the cost catalogue is a port
 *
 * Every LLM call in a step is priced before it is stored, so the optimizer
 * dashboard can show what a run cost. Pricing reads the project's OWN cost
 * rules — a customer's negotiated rate for a model — which live in the model
 * provider vertical, and an experiment package may not reach into it. So the
 * rules arrive as a port, and the arithmetic is the model-provider contract's
 * `matchModelCost`/`estimateCost`, which is what the trace fold and the gateway
 * price spans with.
 *
 * The port is REQUIRED rather than optional, and that is the whole reason this
 * door was not moved earlier: a step recorded with every `cost` null is a step
 * an optimizer dashboard renders as a free run, which is a wrong fact rather
 * than a missing one. A process with no catalogue does not mount the family.
 */
import { handlerManagedAuth } from "@langwatch/api";
import { bodyLimit, type AppRestSecurity, type MountableRestApp } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { zodErrorMessage } from "@langwatch/config";
import {
  dSPyStepRESTParamsSchema,
  type DSPyLLMCall,
  type DSPyStepRESTParams,
  type ExperimentDspyStep,
} from "@langwatch/experiment-contract";
import {
  estimateCost,
  matchModelCost,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { createHash } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import type { ExperimentService } from "@langwatch/experiment-contract";
import type { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service";

const logger = createLogger("langwatch:experiment:dspy");

/** Bodies up to 20MB: a single optimizer batch carries every example it saw. */
const MAX_BODY_BYTES = 20 * 1024 * 1024;

/**
 * A step whose `llm_calls` are large enough that storing them whole would cost
 * more than reading them is worth. The response text is dropped past this.
 */
const MAX_LLM_CALL_BYTES = 256_000;

/** A resolved project credential, or the refusal to answer in its place. */
export type DspyStepsRestCredential =
  | Readonly<{ ok: true; project: Readonly<{ id: string }>; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** What the step log reaches that it does not own. */
export interface DspyStepsRestPorts {
  /** Resolves the request's project key and enforces `experiments:manage`. */
  authenticateCredential(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<DspyStepsRestCredential>;
  /** The ONE find-or-create rule this deployment resolves a slug through. */
  findOrCreate(): ExperimentFindOrCreateService;
  /** The experiment store the steps are written to. */
  experiments(): ExperimentService;
  /**
   * The project's own model cost rules, in the shape the pricing cascade
   * reads. Required: see the docblock.
   */
  listModelCosts(input: { projectId: string }): Promise<readonly ModelCostRate[]>;
  /** Where an invalid body is reported, where this process reports anywhere. */
  reportError?: ((error: unknown, context: Record<string, unknown>) => void) | undefined;
  /** Records the wire size of an accepted batch, where the process meters it. */
  observePayloadSize?: ((bytes: number) => void) | undefined;
}

/** `POST /api/dspy/log_steps`, built against one process's security. */
export function createDspyStepsRestApp(options: {
  security: AppRestSecurity;
  ports: DspyStepsRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const secured = security.createServiceApp({ basePath: "/api" });

  secured
    .access(
      handlerManagedAuth({
        reason: "project auth + permission ceiling enforced by in-route middleware",
        permissions: ["experiments:manage"],
        credential: "apiKey",
      }),
    )
    .post(
      "/dspy/log_steps",
      describeRoute({
        summary: "Report DSPy optimizer steps",
        description:
          "Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores show up in the app. Send the steps as an array; the optimizer typically posts each batch as it finishes. Bodies up to 20MB are accepted.",
        tags: ["Experiments"],
        responses: {
          200: {
            description: "Every step in the batch was recorded",
            content: {
              "application/json": { schema: resolver(z.object({ message: z.string() })) },
            },
          },
          400: {
            description:
              "The body was not valid JSON, failed validation, or carried timestamps in seconds rather than milliseconds",
            content: { "application/json": { schema: resolver(sentenceErrorSchema) } },
          },
          401: {
            description: "Missing or invalid API key",
            content: {
              "application/json": { schema: resolver(z.object({ message: z.string() })) },
            },
          },
          500: {
            description:
              "A step could not be stored. The cause is on our side and is logged with the run and step ids; retrying the batch is safe.",
            content: { "application/json": { schema: resolver(sentenceErrorSchema) } },
          },
        },
      }),
      bodyLimit({ maxSize: MAX_BODY_BYTES }),
      async (c) => {
        const credential = await ports.authenticateCredential({
          request: c.req.raw,
          permission: "experiments:manage",
        });
        if (!credential.ok) {
          return c.json(credential.body, credential.status);
        }
        const project = credential.project;
        credential.markUsed();

        let body: unknown;
        let payloadSize: number;
        try {
          // The size comes from the wire bytes rather than a re-serialisation
          // of the parsed body: bodies here run to 20MB, and stringifying the
          // parse both costs a second full pass and reports UTF-16 code units
          // instead of transferred bytes.
          const raw = await c.req.text();
          payloadSize = Buffer.byteLength(raw, "utf8");
          body = JSON.parse(raw);
        } catch {
          return c.json({ message: "Bad request" }, 400);
        }

        ports.observePayloadSize?.(payloadSize);
        logger.info(
          {
            payloadSize,
            payloadSizeMB: (payloadSize / (1024 * 1024)).toFixed(2),
            projectId: project.id,
          },
          "DSPy log_steps request received",
        );

        const parsed = z.array(dSPyStepRESTParamsSchema).safeParse(body);
        if (!parsed.success) {
          logger.error(
            { error: parsed.error, payloadSize, projectId: project.id },
            "invalid log_steps data received",
          );
          ports.reportError?.(parsed.error, { projectId: project.id });
          return c.json({ error: zodErrorMessage(parsed.error) }, 400);
        }

        for (const param of parsed.data) {
          if (param.timestamps.created_at && param.timestamps.created_at.toString().length === 10) {
            logger.error(
              { stepId: param.index, runId: param.run_id, projectId: project.id },
              "timestamps not in milliseconds for step",
            );
            return c.json(
              {
                error:
                  "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
              },
              400,
            );
          }
        }

        logger.info(
          { stepCount: parsed.data.length, projectId: project.id },
          "Processing DSPy steps",
        );

        for (const param of parsed.data) {
          try {
            await recordStep({ ports, project, param });
          } catch (error) {
            const context = {
              projectId: project.id,
              stepId: param.index,
              runId: param.run_id,
            };
            logger.error({ error, ...context }, "failed to process DSPy step");
            ports.reportError?.(error, context);
            if (error instanceof z.ZodError) {
              return c.json({ error: zodErrorMessage(error) }, 400);
            }
            return c.json(
              { error: error instanceof Error ? error.message : "Internal server error" },
              500,
            );
          }
        }

        return c.json({ message: "ok" });
      },
    );

  return secured.hono;
}

/** The two refusal fields this door has always answered in. */
const sentenceErrorSchema = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});

async function recordStep(input: {
  ports: DspyStepsRestPorts;
  project: Readonly<{ id: string }>;
  param: DSPyStepRESTParams;
}): Promise<void> {
  const { ports, project, param } = input;
  const { run_id, index, experiment_id, experiment_slug } = param;

  const experiment = await ports.findOrCreate().resolve({
    projectId: project.id,
    ...(experiment_id ? { experimentId: experiment_id } : {}),
    ...(experiment_slug ? { experimentSlug: experiment_slug } : {}),
    experimentType: "DSPY",
  });

  const costs = await ports.listModelCosts({ projectId: project.id });
  const now = Date.now();

  const examples = param.examples.map((example) => ({
    ...example,
    trace: example.trace?.map((entry) => {
      if (entry.input?.contexts && typeof entry.input.contexts !== "string") {
        entry.input.contexts = JSON.stringify(entry.input.contexts);
      }
      return entry;
    }),
    hash: hashOf(example),
  }));

  const llmCalls = param.llm_calls
    .map((call) => ({ ...call, hash: hashOf(call) }))
    .map((call) => priceLlmCall(call, costs))
    .map((llmCall) => {
      if (llmCall.response?.output) {
        delete llmCall.response.choices;
      }
      if (llmCall.response && JSON.stringify(llmCall).length >= MAX_LLM_CALL_BYTES) {
        llmCall.response.output = "[truncated]";
        llmCall.response.messages = [];
      }
      return llmCall;
    });

  const stepData: ExperimentDspyStep = {
    tenantId: project.id,
    experimentId: experiment.id,
    runId: run_id,
    stepIndex: index,
    workflowVersionId: param.workflow_version_id,
    score: param.score,
    label: param.label,
    optimizerName: param.optimizer.name,
    optimizerParameters: param.optimizer.parameters,
    predictors: param.predictors,
    examples,
    llmCalls,
    createdAt: param.timestamps.created_at,
    insertedAt: now,
    updatedAt: now,
  };

  await ports.experiments().upsertDspyStep(stepData);

  logger.info(
    { stepId: param.index, runId: param.run_id, projectId: project.id },
    "Successfully stored DSPy step",
  );
}

const hashOf = (data: object): string =>
  createHash("md5").update(JSON.stringify(data)).digest("hex");

/**
 * A DSPy LLM call's `response` is a JSON dump of an arbitrary Python object, so
 * the contract types it as an opaque record. Cost accounting reads only the
 * OpenAI chat-completion fields below, and reads them through this schema so a
 * malformed dump produces no cost rather than a wrong one.
 */
const llmCallCostFieldsSchema = z.object({
  model: z.string().optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

function priceLlmCall(call: DSPyLLMCall, costs: readonly ModelCostRate[]): DSPyLLMCall {
  if (call.__class__ !== "dsp.modules.gpt3.GPT3" && call.response?.object !== "chat.completion") {
    return call;
  }
  const fields = llmCallCostFieldsSchema.safeParse(call.response);
  const costFields = fields.success ? fields.data : undefined;
  const model = costFields?.model;
  const rate = model ? matchModelCost(model, costs) : undefined;
  const promptTokens = costFields?.usage?.prompt_tokens;
  const completionTokens = costFields?.usage?.completion_tokens;
  return {
    ...call,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    cost: rate
      ? estimateCost({
          rate,
          inputTokens: promptTokens ?? 0,
          outputTokens: completionTokens ?? 0,
          // A DSPy dump carries neither cached nor audio usage, so the four
          // remaining dimensions are zero rather than absent: the cascade
          // reads them unconditionally and an omitted one would be `NaN`.
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheCreation1hTokens: 0,
          inputAudioTokens: 0,
          outputAudioTokens: 0,
        })
      : undefined,
  };
}
