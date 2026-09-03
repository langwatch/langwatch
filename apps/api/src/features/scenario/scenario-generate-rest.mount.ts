/**
 * This process's composition of the scenario editor's author-assist
 * (`@langwatch/scenario-server`).
 *
 * The prompt, the schema and the three refusals the generator answers with
 * are the feature's. What is this process's is the session, the model, and the
 * TIME BUDGET one generation is allowed — the cap that keeps a hung gateway
 * from holding a request open long enough for a front proxy to substitute its
 * own HTML error page.
 *
 * The budget is read from the environment at call time rather than at
 * composition, which is what the route it replaces did: a test drives a real
 * abort by stating a small one, and a non-positive or unparseable value falls
 * back to the generator's own default rather than to no cap at all.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
  createScenarioGenerateRestApp,
} from "@langwatch/scenario-server";

import type { ApiAuthoringModelResolver } from "../../app/api-authoring-model.composition";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session";

/** The environment variable a deployment may narrow the generation cap with. */
const SCENARIO_GENERATE_TIMEOUT_ENV = "SCENARIO_GENERATE_TIMEOUT_MS";

/** `/api/scenario/generate`, bound to one process. */
export function mountScenarioGenerateRest(options: {
  security: AppRestSecurity;
  session: ApiHandlerManagedSessionPort;
  resolveModel: ApiAuthoringModelResolver;
  timeoutMs?: (() => number) | undefined;
}): MountableRestApp {
  const { security, session, resolveModel } = options;
  const timeoutMs = options.timeoutMs ?? defaultScenarioGenerateTimeoutMs;
  return createScenarioGenerateRestApp<HandlerManagedSession>({
    security,
    ports: {
      resolveSession: (request) => session.resolve(request),
      probeProjectPermission: (person, projectId, permission) =>
        session.permitted({ session: person, projectId, permission }),
      resolveModel,
      timeoutMs,
    },
  });
}

function defaultScenarioGenerateTimeoutMs(): number {
  const override = Number(process.env[SCENARIO_GENERATE_TIMEOUT_ENV]);
  return Number.isFinite(override) && override > 0
    ? override
    : SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS;
}
