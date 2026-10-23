import {
  LEGACY_PROJECT_KEY_LOG_WINDOW_MS,
  LEGACY_PROJECT_KEY_LOGGER_NAME,
  LegacyProjectKeyIngestionOnlyError,
  legacyProjectKeyUseLines,
  legacyProjectKeyUseSpanAttributes,
  legacyProjectKeyUseWindowKey,
  type LegacyProjectKeyUse,
} from "@langwatch/api-key-contract";
import { createLogger, createWarnThrottle } from "@langwatch/observability";
import type { ProjectKeyedProbeRequest } from "@langwatch/platform-health-contract";
import { deriveRunActor } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { trace } from "@opentelemetry/api";

import type { ProjectKeyedProbeAnswer } from "../rules/probe-answers.rules.ts";
import { canaryAnswer, MAX_CANARY_QUERY_PARAM_LENGTH } from "../rules/scenario-canary.rules.ts";
import type { ScenarioCanaryService } from "./scenario-canary.service.ts";
import type { SubsystemProbeOutcome, SubsystemProbeService } from "./subsystem-probe.service.ts";

/**
 * Who a probe's key acts as: its project, and the key and its owner when it is an API key.
 * `legacyKeyOutsideScope` marks a legacy project key without full access: logged on any probe
 * but the collector, and refused there once its project is enforced.
 */
type ProbeCaller = Readonly<{
  projectId: string;
  userId: string | null;
  apiKeyId: string | null;
  legacyKeyOutsideScope: Readonly<{ organizationId: string; enforced: boolean }> | null;
}>;

const legacyKeyLogger = createLogger(LEGACY_PROJECT_KEY_LOGGER_NAME);

/** Resolves a raw token, project key or API key, to its caller as main's TokenResolver did. */
type ProbeCallerResolver = (
  input: Readonly<{ token: string; projectId: string | null }>,
) => Promise<ProbeCaller | null>;

/** An answer before the door decides whether it may be cached. */
type ProbeBody = Readonly<{ status: number; body: unknown }>;

const json = (status: number, body: unknown): ProbeBody => ({ status, body });

const answerOf = (outcome: SubsystemProbeOutcome): ProbeBody =>
  outcome.ok
    ? json(200, { status: outcome.status, body: outcome.body })
    : json(outcome.httpStatus, { message: outcome.message });

/**
 * The project-keyed `/api/health/*` door: the caller's own key is resolved to a project and
 * forwarded to the canaries, and each answer is main's `{ status, body }` or `{ message }`.
 */
export class ProjectKeyedProbeService {
  readonly #probes: SubsystemProbeService;
  readonly #resolveCaller: ProbeCallerResolver;
  readonly #scenarioCanary: ScenarioCanaryService;
  /** One legacy key line per project and probe per window in this process. */
  readonly #legacyKeyWindow = createWarnThrottle(LEGACY_PROJECT_KEY_LOG_WINDOW_MS);

  private constructor(options: {
    probes: SubsystemProbeService;
    resolveCaller: ProbeCallerResolver;
    scenarioCanary: ScenarioCanaryService;
  }) {
    this.#probes = options.probes;
    this.#resolveCaller = options.resolveCaller;
    this.#scenarioCanary = options.scenarioCanary;
  }

  static create(options: {
    probes: SubsystemProbeService;
    resolveCaller: ProbeCallerResolver;
    scenarioCanary: ScenarioCanaryService;
  }): ProjectKeyedProbeService {
    return new ProjectKeyedProbeService(options);
  }

  async probe(request: ProjectKeyedProbeRequest): Promise<ProjectKeyedProbeAnswer> {
    const answer = await this.#answer(request);
    return { ...answer, noStore: request.check === "scenarios" };
  }

  async #answer(request: ProjectKeyedProbeRequest): Promise<ProbeBody> {
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

    const caller = await this.#resolveCaller({
      token: authToken,
      projectId: request.headers["x-project-id"] ?? null,
    });
    if (!caller) return json(401, { message: "Invalid auth token." });
    const { projectId } = caller;
    // Only the collector canary is ingestion; every other probe reads or runs project data.
    const outside = caller.legacyKeyOutsideScope;
    if (outside && request.check !== "collector") {
      this.#recordOutsideScope({ caller, check: request.check });
      if (outside.enforced) {
        const refusal = new LegacyProjectKeyIngestionOnlyError();
        return json(refusal.httpStatus, { code: refusal.code, message: refusal.message });
      }
    }

    if (request.check === "scenarios")
      return this.#runScenarioCanary({ caller, requested: request.runPlanId });

    return answerOf(await this.#run(request, { authToken, projectId, signal: request.signal }));
  }

  #recordOutsideScope({ caller, check }: { caller: ProbeCaller; check: string }): void {
    if (!caller.legacyKeyOutsideScope) return;
    const use: LegacyProjectKeyUse = {
      projectId: caller.projectId,
      organizationId: caller.legacyKeyOutsideScope.organizationId,
      route: `GET /api/health/${check}`,
      permission: null,
      routeScopes: [],
    };
    const decision = {
      outsideScope: true,
      enforced: caller.legacyKeyOutsideScope.enforced,
    } as const;
    trace.getActiveSpan()?.setAttributes(legacyProjectKeyUseSpanAttributes({ use, decision }));
    const suppressed = this.#legacyKeyWindow.claim({
      key: legacyProjectKeyUseWindowKey(use),
      now: nowInstant().epochMilliseconds,
    });
    if (suppressed === undefined) return;
    for (const line of legacyProjectKeyUseLines({ use, decision, suppressed })) {
      legacyKeyLogger[line.level](line.fields, line.message);
    }
  }

  async #runScenarioCanary({
    caller,
    requested,
  }: {
    caller: ProbeCaller;
    requested: string | undefined;
  }): Promise<ProbeBody> {
    const runPlanId = requested?.trim();
    if (runPlanId && runPlanId.length > MAX_CANARY_QUERY_PARAM_LENGTH) {
      return json(400, { message: "runPlanId query parameter is invalid." });
    }
    if (!runPlanId) return json(400, { message: "runPlanId query parameter is required." });

    // The run acts as the probe's own key, as a REST start would; a project key starts it
    // as nobody.
    const actor = deriveRunActor({
      userId: caller.userId,
      surfaceHeader: null,
      apiKeyId: caller.apiKeyId,
    });
    const { projectId } = caller;
    const outcome = await this.#scenarioCanary.run({ projectId, runPlanId, actor });
    const { status, body } = canaryAnswer(outcome);
    return json(status, body);
  }

  #run(
    request: Exclude<ProjectKeyedProbeRequest, { check: "scenarios" }>,
    credential: Readonly<{ authToken: string; projectId: string; signal: AbortSignal | undefined }>,
  ): Promise<SubsystemProbeOutcome> {
    const { authToken, projectId, signal } = credential;
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
          signal,
        });
    }
  }
}
