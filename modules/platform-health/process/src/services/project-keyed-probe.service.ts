import type { ProjectKeyedProbeRequest } from "@langwatch/platform-health-contract";

import { canaryAnswer, MAX_CANARY_QUERY_PARAM_LENGTH } from "../rules/scenario-canary.rules.ts";
import type { ScenarioCanaryService } from "./scenario-canary.service.ts";
import type { SubsystemProbeOutcome, SubsystemProbeService } from "./subsystem-probe.service.ts";

/** Resolves a raw token, project key or API key, to its project as main's TokenResolver did. */
export type ProbeProjectResolver = (
  input: Readonly<{ token: string; projectId: string | null }>,
) => Promise<string | null>;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

/** A monitor must see each canary run's real result, so no canary answer is cacheable. */
const NO_STORE = { "Cache-Control": "no-store" };

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
  readonly #scenarioCanary: ScenarioCanaryService;

  private constructor(options: {
    probes: SubsystemProbeService;
    resolveProject: ProbeProjectResolver;
    scenarioCanary: ScenarioCanaryService;
  }) {
    this.#probes = options.probes;
    this.#resolveProject = options.resolveProject;
    this.#scenarioCanary = options.scenarioCanary;
  }

  static create(options: {
    probes: SubsystemProbeService;
    resolveProject: ProbeProjectResolver;
    scenarioCanary: ScenarioCanaryService;
  }): ProjectKeyedProbeService {
    return new ProjectKeyedProbeService(options);
  }

  async probe(request: ProjectKeyedProbeRequest): Promise<Response> {
    const answer = await this.#answer(request);
    if (request.check !== "scenarios") return answer;
    for (const [name, value] of Object.entries(NO_STORE)) answer.headers.set(name, value);
    return answer;
  }

  async #answer(request: ProjectKeyedProbeRequest): Promise<Response> {
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

    if (request.check === "scenarios")
      return this.#runScenarioCanary({ projectId, requested: request.runPlanId });

    return answerOf(await this.#run(request, { authToken, projectId }));
  }

  async #runScenarioCanary({
    projectId,
    requested,
  }: {
    projectId: string;
    requested: string | undefined;
  }): Promise<Response> {
    const runPlanId = requested?.trim();
    if (runPlanId && runPlanId.length > MAX_CANARY_QUERY_PARAM_LENGTH) {
      return json(400, { message: "runPlanId query parameter is invalid." });
    }
    if (!runPlanId) return json(400, { message: "runPlanId query parameter is required." });

    const { status, body } = canaryAnswer(await this.#scenarioCanary.run({ projectId, runPlanId }));
    return json(status, body);
  }

  #run(
    request: Exclude<ProjectKeyedProbeRequest, { check: "scenarios" }>,
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
