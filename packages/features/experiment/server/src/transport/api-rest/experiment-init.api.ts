/**
 * `POST /api/experiment/init` — the first call an SDK run makes. Resolves a
 * caller-chosen slug through `ExperimentFindOrCreateService`, the same
 * service the batch log uses, so repeated runs under one slug group together.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  resolver,
  type RestErrorHandler,
  type ServiceContext,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { zodErrorMessage } from "@langwatch/config";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service";
import {
  experimentInitBadRequestSchema,
  experimentInitForbiddenSchema,
  experimentInitResponseSchema,
} from "../../rules/experiment-schemas.rules";

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
 * A body this door refuses in its own words, rather than through either
 * envelope: the SDKs parse these two shapes.
 */
class ExperimentInitRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("experiment init refused");
    this.name = "ExperimentInitRefusal";
  }
}

/** What the credential middleware puts on the context for the handler. */
const INIT_CALLER = "experimentInitCaller";

type ExperimentInitCaller = Readonly<{
  project: Readonly<{ id: string; slug: string }>;
  markUsed: () => void;
}>;

/**
 * The caller the middleware resolved, read off the handler's own context: a
 * structural reader rather than widening the framework's own variables map.
 */
function callerOf(c: {
  get(key: typeof INIT_CALLER): ExperimentInitCaller | undefined;
}): ExperimentInitCaller {
  const caller = c.get(INIT_CALLER);
  if (!caller) {
    throw new Error("No credential on the request context: the init door's middleware did not run");
  }
  return caller;
}

/**
 * `experiment_slug` and `experiment_id` are individually optional and jointly
 * required. `EVALUATIONS_V3` is deliberately not among the accepted types —
 * that is the workbench's own type, written through the workbench's doors.
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

  // `/api` with no version namespace: the family owns one literal path under a
  // prefix twenty other families share, and a version guard here would claim
  // every one of their URLs.
  const { service, policy } = security.createServiceVersionedApp({
    name: "experiment-init",
    basePath: "/api",
    bareMount: true,
    errorEnvelope: "legacy",
    errorHandler:
      (boundary): RestErrorHandler =>
      (error, c) =>
        error instanceof ExperimentInitRefusal
          ? c.json(error.body, error.status)
          : boundary(error, c),
  });

  /**
   * The project key, resolved before the body is read — the order this door
   * has always answered in: an unauthenticated call is refused as such
   * whatever it carries.
   */
  const authenticate: MiddlewareHandler = async (c, next) => {
    const credential = await ports.authenticateCredential({
      request: c.req.raw,
      permission: "experiments:manage",
    });
    if (!credential.ok) {
      throw new ExperimentInitRefusal(credential.status, credential.body);
    }
    c.set(INIT_CALLER, { project: credential.project, markUsed: credential.markUsed });
    await next();
  };

  const initHandler = async (c: ServiceContext<EndpointVariables>, input: { body: string }) => {
    const { project, markUsed } = callerOf(c);

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(input.body);
    } catch {
      throw new ExperimentInitRefusal(400, { message: "Bad request" });
    }

    const parsed = experimentInitBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      logger.error({ error: parsed.error, projectId: project.id }, "invalid init data received");
      ports.reportError?.(parsed.error, { projectId: project.id });
      throw new ExperimentInitRefusal(400, { error: zodErrorMessage(parsed.error) });
    }
    const params = parsed.data;

    let experiment;
    try {
      experiment = await ports.findOrCreate().resolve({
        projectId: project.id,
        // Both identifiers are forwarded. The route this replaces sent only the
        // slug, so an id-only request passed validation and then raised
        // "Either experiment_id or experiment_slug is required" as a 500.
        experimentId: params.experiment_id,
        experimentSlug: params.experiment_slug,
        experimentType: params.experiment_type,
        experimentName: params.experiment_name,
        workflowId: params.workflowId,
      });
    } catch (error) {
      // Matched on the CODE, not on the licence layer's own error class: that
      // class lives in an enterprise package this one may not reach, and a code
      // comparison is what the repo asks for anywhere an error may have crossed
      // a serialisation boundary. The flat body below is the wire an SDK's
      // limit handling already reads.
      if (error instanceof HandledError && error.code === "resource_limit_exceeded") {
        const meta = error.meta;
        throw new ExperimentInitRefusal(403, {
          error: error.code,
          message: error.message,
          limitType: meta.limitType,
          current: meta.current,
          max: meta.max,
        });
      }
      throw error;
    }

    markUsed();
    return {
      path: `/${project.slug}/experiments/${experiment.slug}`,
      slug: experiment.slug,
    };
  };

  return service
    .registerRoute("post", "/experiment/init", MANAGEMENT_API_VERSION, initHandler, (b) =>
      policy(
        handlerManagedAuth({
          // Experiments carry their own RBAC permission, decoupled from
          // workflows: initializing an experiment run is `experiments:manage`.
          reason:
            "project API key resolved by the process's credential port and its ceiling enforced",
          permissions: ["experiments:manage"],
          credential: "apiKey",
        }),
      )(b)
        .withMiddleware(authenticate)
        // Read as bytes, parsed here: this handler answers its own sentence on
        // a bad body — built by `zodErrorMessage` from the schema's own
        // failure, and reported to the process's error sink with that failure
        // in hand — which a validated input cannot hand back.
        .withRawBody("text", { contentType: "application/json" })
        .withOutput(experimentInitResponseSchema)
        .withDocs({
          operationId: "initExperiment",
          summary: "Create an experiment",
          description:
            "Create an experiment, or return the existing one when the slug is already taken. This is the first call in an experiment run: take the slug back, report results against it, and every run under that slug groups together in the app. The SDKs call this endpoint for you. The body carries `experiment_type` and at least one of `experiment_slug` (the stable slug you choose, which is what makes repeated runs land together) or `experiment_id`; `experiment_name` names it on creation and `workflowId` ties it to an Optimization Studio workflow.",
          tags: ["Experiments"],
          responses: {
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
    )
    .build();
}
