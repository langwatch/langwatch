/**
 * The project-keyed door onto the five subsystem probes, which live in
 * `@langwatch/platform-health-server`.
 * @see modules/platform-health/specs/platform-health.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

/** One project, as a probe's key resolves to it. */
export type HealthProbeProject = Readonly<{ id: string }>;

/** What a probe that passed answers: the canary's own status, and its body. */
export type HealthProbeAnswer = Readonly<{ status: number; body: unknown }>;

/** The five probes, plus the key resolution each of them answers behind. */
export interface HealthProbeApi {
  /** Resolves a raw project API key to its project, or nothing. */
  resolveProjectByApiKey(token: string): Promise<HealthProbeProject | null>;
  runCollector(input: { authToken: string }): Promise<HealthProbeAnswer>;
  runEvaluations(input: { authToken: string }): Promise<HealthProbeAnswer>;
  runProcessor(input: { authToken: string }): Promise<HealthProbeAnswer>;
  runTriggers(input: { projectId: string; triggerId: string }): Promise<HealthProbeAnswer>;
  runWorkflows(input: {
    projectId: string;
    workflowId: string;
    authToken: string;
  }): Promise<HealthProbeAnswer>;
}

export const HealthProbeApi = featureApi<HealthProbeApi>("platform-health");

/** No token at all, in the sentence this family has always answered with. */
export class HealthProbeTokenMissingError extends Error {
  constructor() {
    super(
      "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    );
    this.name = "HealthProbeTokenMissingError";
  }
}

/** A token this deployment does not know. */
export class HealthProbeTokenInvalidError extends Error {
  constructor() {
    super("Invalid auth token.");
    this.name = "HealthProbeTokenInvalidError";
  }
}

/** A probe that ran and did not pass, at the status it reports itself. */
export class HealthProbeFailedError extends Error {
  constructor(
    readonly httpStatus: 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "HealthProbeFailedError";
  }
}

/** The `X-Auth-Token` header, as the process read it. */
export const healthProbeAuthToken = defineRestMiddleware(
  "healthProbeAuthToken",
  z.string().nullable(),
);

/** The `Authorization` header, for the callers that send a bearer instead. */
export const healthProbeAuthorization = defineRestMiddleware(
  "healthProbeAuthorization",
  z.string().nullable(),
);

const canary = publicRoute({
  reason:
    "project API key presented as X-Auth-Token or Authorization: Bearer and resolved by the route itself; the canary's own requests carry the same key and are authorized on their own routes",
});

const answer = z.object({ status: z.number(), body: z.unknown().optional() });

/**
 * `/api/health/*`, at exactly the paths an orchestrator's probe URL names.
 * Literal because `/api/health` itself belongs to the process's lifecycle
 * surface, so this family owns the five sub-paths and no prefix.
 */
export const healthProbeRest = defineRestRouter(HealthProbeApi)
  .withNamespace("health")
  .withVersion(MANAGEMENT_API_VERSION)
  // No `/api/v1` twin: the probes are the deployment's own surface, not the
  // published product API, and an orchestrator's probe URL is configuration.
  .withAddressing("literal", { v1Twin: false })

  .get("/api/health/collector", "probeCollector")
  .withAccess(canary)
  .withMiddleware(healthProbeAuthToken, healthProbeAuthorization)
  .withOutput(answer)
  .handle(async ({ app }, xAuthToken, authorization) => {
    const authToken = presented(xAuthToken, authorization);
    await accepted(app, authToken);

    return app.runCollector({ authToken });
  })

  .get("/api/health/evaluations", "probeEvaluations")
  .withAccess(canary)
  .withMiddleware(healthProbeAuthToken, healthProbeAuthorization)
  .withOutput(answer)
  .handle(async ({ app }, xAuthToken, authorization) => {
    const authToken = presented(xAuthToken, authorization);
    await accepted(app, authToken);

    return app.runEvaluations({ authToken });
  })

  .get("/api/health/processor", "probeProcessor")
  .withAccess(canary)
  .withMiddleware(healthProbeAuthToken, healthProbeAuthorization)
  .withOutput(answer)
  .handle(async ({ app }, xAuthToken, authorization) => {
    const authToken = presented(xAuthToken, authorization);
    await accepted(app, authToken);

    return app.runProcessor({ authToken });
  })

  .get("/api/health/triggers", "probeTriggers")
  .withQuery(z.object({ triggerId: z.string().optional() }))
  .withAccess(canary)
  .withMiddleware(healthProbeAuthToken, healthProbeAuthorization)
  .withOutput(answer)
  .handle(async ({ app, input }, xAuthToken, authorization) => {
    const project = await accepted(app, presented(xAuthToken, authorization));

    return app.runTriggers({ projectId: project.id, triggerId: input.triggerId ?? "" });
  })

  .get("/api/health/workflows", "probeWorkflows")
  .withQuery(z.object({ workflowId: z.string().optional() }))
  .withAccess(canary)
  .withMiddleware(healthProbeAuthToken, healthProbeAuthorization)
  .withOutput(answer)
  .handle(async ({ app, input }, xAuthToken, authorization) => {
    const authToken = presented(xAuthToken, authorization);
    const project = await accepted(app, authToken);

    return app.runWorkflows({
      projectId: project.id,
      workflowId: input.workflowId ?? "",
      authToken,
    });
  })
  .build();

/** The token the caller presented, in either of the two headers it may use. */
function presented(xAuthToken: string | null, authorization: string | null): string {
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  const token = xAuthToken ?? bearer;
  if (!token) throw new HealthProbeTokenMissingError();

  return token;
}

/** The project the key resolves to, refused where it resolves to none. */
async function accepted(app: HealthProbeApi, authToken: string): Promise<HealthProbeProject> {
  const project = await app.resolveProjectByApiKey(authToken);
  if (!project) throw new HealthProbeTokenInvalidError();

  return project;
}
