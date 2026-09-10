/**
 * This process's composition of the scenario editor's author-assist
 * (`@langwatch/scenario-server`).
 */
import type { MountableRestApp, RestErrorHandler } from "@langwatch/api/rest";
import {
  createScenarioGenerateRest,
  SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
} from "@langwatch/scenario-server";
import { ScenarioApi } from "@langwatch/scenario-contract";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiAuthoringModelResolver } from "../../app/api-authoring-model.composition.ts";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session.ts";

/** The environment variable a deployment may narrow the generation cap with. */
const SCENARIO_GENERATE_TIMEOUT_ENV = "SCENARIO_GENERATE_TIMEOUT_MS";

/** `/api/scenario/generate`, bound to one process. */
export function mountScenarioGenerateRest(
  runtime: ApiRestRuntime,
  options: {
    scenarios: () => ScenarioApi;
    session: ApiHandlerManagedSessionPort;
    resolveModel: ApiAuthoringModelResolver;
    /** The cap one generation is allowed, asked again on every request. */
    timeoutMs: () => number;
    errors: RestErrorHandler;
  },
): MountableRestApp {
  const { scenarios, session, resolveModel, timeoutMs, errors } = options;
  const declaration = createScenarioGenerateRest<HandlerManagedSession>({
    resolveSession: (request) => session.resolve(request),
    probeProjectPermission: (person, projectId, permission) =>
      session.permitted({ session: person, projectId, permission }),
    resolveModel,
    timeoutMs,
  });

  return runtime.mount(declaration, scenarios, { onError: errors });
}

/**
 * The cap this deployment states, or the generator's own default when it states
 * nothing usable. Takes the environment rather than reading it, so the value
 * arrives from the composition root like the rest of this process's configuration.
 */
export function readScenarioGenerateTimeoutMs(source: NodeJS.ProcessEnv): number {
  const override = Number(source[SCENARIO_GENERATE_TIMEOUT_ENV]);
  return Number.isFinite(override) && override > 0
    ? override
    : SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS;
}
