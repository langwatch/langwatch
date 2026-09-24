import type { ProjectKeyedProbeRequest } from "@langwatch/platform-health-contract";

import type { SubsystemProbeOutcome, SubsystemProbeService } from "./subsystem-probe.service.ts";

/** Resolves a raw token, project key or API key, to its project as main's TokenResolver did. */
export type ProbeProjectResolver = (
  input: Readonly<{ token: string; projectId: string | null }>,
) => Promise<string | null>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const answerOf = (outcome: SubsystemProbeOutcome): Response =>
  outcome.ok
    ? json(200, { status: outcome.status, body: outcome.body })
    : json(outcome.httpStatus, { message: outcome.message });

/**
 * The project-keyed `/api/health/*` door: the caller's own key is resolved to a project and
 * forwarded to the canaries, and each answer is main's `{ status, body }` or `{ message }`.
 */
export class ProjectKeyedProbeService {
  readonly #probes: SubsystemProbeService;
  readonly #resolveProject: ProbeProjectResolver;

  private constructor(probes: SubsystemProbeService, resolveProject: ProbeProjectResolver) {
    this.#probes = probes;
    this.#resolveProject = resolveProject;
  }

  static create(options: {
    probes: SubsystemProbeService;
    resolveProject: ProbeProjectResolver;
  }): ProjectKeyedProbeService {
    return new ProjectKeyedProbeService(options.probes, options.resolveProject);
  }

  async probe(request: ProjectKeyedProbeRequest): Promise<Response> {
    const { authorization } = request.headers;
    const authToken =
      request.headers["x-auth-token"] ??
      (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
    if (!authToken) {
      return json(401, {
        message:
          "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      });
    }

    const projectId = await this.#resolveProject({
      token: authToken,
      projectId: request.headers["x-project-id"] ?? null,
    });
    if (!projectId) return json(401, { message: "Invalid auth token." });

    return answerOf(await this.#run(request, { authToken, projectId }));
  }

  #run(
    request: ProjectKeyedProbeRequest,
    credential: Readonly<{ authToken: string; projectId: string }>,
  ): Promise<SubsystemProbeOutcome> {
    const { authToken, projectId } = credential;
    switch (request.check) {
      case "collector":
        return this.#probes.runCollector(credential);
      case "evaluations":
        return this.#probes.runEvaluations(credential);
      case "processor":
        return this.#probes.runProcessor(credential);
      case "triggers":
        return this.#probes.runTriggers({ projectId, triggerId: request.triggerId ?? "" });
      case "workflows":
        return this.#probes.runWorkflows({
          projectId,
          workflowId: request.workflowId ?? "",
          authToken,
        });
    }
  }
}
