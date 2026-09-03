/**
 * `POST /api/experiment/init` — the first call an SDK run makes.
 *
 * It takes a slug the caller chose, hands back the experiment that slug names,
 * and creates it if the slug is free. Every subsequent write in the run —
 * `POST /api/evaluations/batch/log_results`, the DSPy step log, the workbench
 * reads — addresses rows by the experiment this call resolved, which is what
 * makes repeated runs under one slug group together in the app rather than
 * landing as strangers.
 *
 * That is also why the resolution is a SERVICE and not a rule this file
 * states: the batch log resolves the same slug through the same
 * `ExperimentFindOrCreateService`, so an SDK cannot get one experiment from
 * the init door and a second one from the door it reports to.
 *
 * The family resolves its own project key rather than going through the
 * framework chain, because the refusals it publishes are the ones an SDK
 * already parses: a bare `{ message }` at 401, `{ error: <sentence> }` at 400,
 * and the handled ceiling payload at 403.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { zodErrorMessage } from "@langwatch/config";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import type { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service";
import {
  experimentInitBadRequestSchema,
  experimentInitForbiddenSchema,
  experimentInitResponseSchema,
} from "./experiment.schemas";

const logger = createLogger("langwatch:experiment:init");

/** A resolved project credential, or the refusal to answer in its place. */
export type ExperimentInitRestCredential =
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string; slug: string }>;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** What the init door reaches that it does not own. */
export interface ExperimentInitRestPorts {
  /** Resolves the request's project key and enforces `experiments:manage`. */
  authenticateCredential(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<ExperimentInitRestCredential>;
  /** The ONE find-or-create rule this deployment resolves a slug through. */
  findOrCreate(): ExperimentFindOrCreateService;
  /** Where an invalid body is reported, where this process reports anywhere. */
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
}

/**
 * The body, as the door has always accepted it.
 *
 * `experiment_slug` and `experiment_id` are individually optional and jointly
 * required, which is what the refine says. The three types are the ones an SDK
 * sends; `EVALUATIONS_V3` is deliberately NOT among them — that is the
 * workbench's own type, written through the workbench's own doors.
 */
const experimentInitBodySchema = z
  .object({
    experiment_id: z.string().optional().nullable(),
    experiment_slug: z.string().optional().nullable(),
    experiment_type: z.enum(["DSPY", "BATCH_EVALUATION", "BATCH_EVALUATION_V2"]),
    experiment_name: z.string().optional(),
    workflowId: z.string().optional(),
  })
  .refine((data) => Boolean(data.experiment_id ?? data.experiment_slug));

/** `POST /api/experiment/init`, bound to one process. */
export function createExperimentInitRestApp(options: {
  security: AppRestSecurity;
  ports: ExperimentInitRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

  secured
    .access(
      handlerManagedAuth({
        // Experiments carry their own RBAC permission, decoupled from
        // workflows: initializing an experiment run is `experiments:manage`.
        reason:
          "project API key resolved by the process's credential port and its ceiling enforced",
        permissions: ["experiments:manage"],
        credential: "apiKey",
      }),
    )
    .post(
      "/experiment/init",
      describeRoute({
        summary: "Create an experiment",
        description:
          "Create an experiment, or return the existing one when the slug is already taken. This is the first call in an experiment run: take the slug back, report results against it, and every run under that slug groups together in the app. The SDKs call this endpoint for you.",
        tags: ["Experiments"],
        // Declared by hand rather than through a validator: this handler parses
        // the body itself and answers its own sentence on a bad one, so there is
        // no validator schema for the generator to read. `experiment_slug` and
        // `experiment_id` are individually optional and jointly required, which
        // `anyOf` states and a required-list cannot.
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object" as const,
                properties: {
                  experiment_slug: {
                    type: "string",
                    description:
                      "Stable slug you choose. Reusing it returns the same experiment instead of creating another, which is what makes repeated runs land together.",
                  },
                  experiment_id: {
                    type: "string",
                    description: "Existing experiment id, as an alternative to the slug",
                  },
                  experiment_type: {
                    type: "string",
                    enum: ["DSPY", "BATCH_EVALUATION", "BATCH_EVALUATION_V2"],
                    description:
                      "BATCH_EVALUATION_V2 for SDK batch evaluations, DSPY for optimizer runs",
                  },
                  experiment_name: {
                    type: "string",
                    description: "Display name, used only when the experiment is created",
                  },
                  workflowId: {
                    type: "string",
                    description: "Optimization Studio workflow this experiment belongs to",
                  },
                },
                required: ["experiment_type"],
                // `anyOf`, not `oneOf`: the refine only asks that at least one
                // identifier is present, and sending both is accepted. `oneOf`
                // would document exactly-one and reject a valid body.
                anyOf: [{ required: ["experiment_slug"] }, { required: ["experiment_id"] }],
              },
            },
          },
        },
        responses: {
          200: {
            description: "The experiment, created or already existing",
            content: {
              "application/json": { schema: resolver(experimentInitResponseSchema) },
            },
          },
          400: {
            description:
              "The body was not valid JSON, or neither experiment_slug nor experiment_id was supplied",
            content: {
              "application/json": { schema: resolver(experimentInitBadRequestSchema) },
            },
          },
          401: {
            description: "Missing or invalid API key",
            content: {
              "application/json": { schema: resolver(z.object({ message: z.string() })) },
            },
          },
          403: {
            description:
              "The API key lacks experiments:manage, or the plan's experiment limit is already reached",
            content: {
              "application/json": { schema: resolver(experimentInitForbiddenSchema) },
            },
          },
        },
      }),
      async (c) => {
        const credential = await ports.authenticateCredential({
          request: c.req.raw,
          permission: "experiments:manage",
        });
        if (!credential.ok) {
          return c.json(credential.body, credential.status);
        }
        const project = credential.project;

        let rawBody: unknown;
        try {
          rawBody = await c.req.json();
        } catch {
          return c.json({ message: "Bad request" }, 400);
        }

        const parsed = experimentInitBodySchema.safeParse(rawBody);
        if (!parsed.success) {
          logger.error(
            { error: parsed.error, projectId: project.id },
            "invalid init data received",
          );
          ports.reportError?.(parsed.error, { projectId: project.id });
          return c.json({ error: zodErrorMessage(parsed.error) }, 400);
        }
        const params = parsed.data;

        let experiment;
        try {
          experiment = await ports.findOrCreate().resolve({
            projectId: project.id,
            // Both identifiers are forwarded. The route this replaces sent
            // only the slug, so an id-only request passed validation and then
            // raised "Either experiment_id or experiment_slug is required" as
            // a 500.
            experimentId: params.experiment_id,
            experimentSlug: params.experiment_slug,
            experimentType: params.experiment_type,
            experimentName: params.experiment_name,
            workflowId: params.workflowId,
          });
        } catch (error) {
          // Matched on the CODE, not on the licence layer's own error class:
          // that class lives in an enterprise package this one may not reach,
          // and a code comparison is what the repo asks for anywhere an error
          // may have crossed a serialisation boundary. The flat body below is
          // the wire an SDK's limit handling already reads.
          if (error instanceof HandledError && error.code === "resource_limit_exceeded") {
            const meta = error.meta;
            return c.json(
              {
                error: error.code,
                message: error.message,
                limitType: meta.limitType,
                current: meta.current,
                max: meta.max,
              },
              403,
            );
          }
          throw error;
        }

        credential.markUsed();
        return c.json({
          path: `/${project.slug}/experiments/${experiment.slug}`,
          slug: experiment.slug,
        });
      },
    );

  return secured.hono;
}
