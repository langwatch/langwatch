/**
 * Binds the five subsystem probes to this process's own graph. The family
 * resolves no credential through the door — the probes accept a project API
 * key in either of two headers — so the routes read the key themselves.
 */
import {
  bindRestHeader,
  createRestRuntime,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  SubsystemProbeService,
  type SubsystemProbeOutcome,
} from "@langwatch/platform-health-server";
import { fromDate } from "@langwatch/time";

import {
  HealthProbeFailedError,
  type HealthProbeAnswer,
  type HealthProbeApi,
  type HealthProbeProject,
  healthProbeAuthorization,
  healthProbeAuthToken,
  healthProbeRest,
  HealthProbeTokenInvalidError,
  HealthProbeTokenMissingError,
} from "./health-probe.rest.ts";

/** What the five probes reach that they do not own. */
export interface HealthProbeRestPorts {
  /**
   * Resolves a raw project API key to its project, or nothing.
   */
  resolveProjectByApiKey(token: string): Promise<HealthProbeProject | null>;
  /** The deployment's public origin, which every canary is posted back through. */
  publicBaseUrl: string;
  /** The automation application the trigger probe reads a recent fire from. */
  automation(): Readonly<{
    tryGetById(input: { triggerId: string; projectId: string }): Promise<unknown | null>;
    getRecentFires(input: {
      projectId: string;
      triggerId: string;
      limit: number;
    }): Promise<ReadonlyArray<{ createdAt: Date }>>;
  }>;
  /** Whether the project has the workflow the workflow probe was pointed at. */
  workflowExists(input: { workflowId: string; projectId: string }): Promise<boolean>;
}

/** `/api/health/collector` and its four siblings, bound to one process. */
export function mountHealthProbeRest(options: {
  ports: HealthProbeRestPorts;
}): MountableRestApp {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("A health probe route answers with no credential resolved.");
      },
    },
  });

  return runtime.mount(healthProbeRest.router(), {
    app: () => healthProbeApp(options.ports),
    credential: "public",
    onError: healthProbeErrors,
    facts: [
      bindRestHeader(healthProbeAuthToken, "x-auth-token"),
      bindRestHeader(healthProbeAuthorization, "authorization"),
    ],
  });
}

/** The probes themselves, over the ports this process composed for them. */
function healthProbeApp(ports: HealthProbeRestPorts): HealthProbeApi {
  const probes = SubsystemProbeService.create({
    collaborators: {
      publicBaseUrl: ports.publicBaseUrl,
      automation: () => {
        const automation = ports.automation();
        return {
          findById: (input) => automation.tryGetById(input),
          getRecentFires: async (input) =>
            (await automation.getRecentFires(input)).map((fire) => ({
              firedAt: fromDate(fire.createdAt),
            })),
        };
      },
      workflowExists: (input) => ports.workflowExists(input),
    },
  });

  return {
    resolveProjectByApiKey: (token) => ports.resolveProjectByApiKey(token),
    runCollector: async (input) => passed(await probes.runCollector(input)),
    runEvaluations: async (input) => passed(await probes.runEvaluations(input)),
    runProcessor: async (input) => passed(await probes.runProcessor(input)),
    runTriggers: async (input) => passed(await probes.runTriggers(input)),
    runWorkflows: async (input) => passed(await probes.runWorkflows(input)),
  };
}

/** A probe that did not pass is a failure the family's boundary renders. */
function passed(outcome: SubsystemProbeOutcome): HealthProbeAnswer {
  if (!outcome.ok) throw new HealthProbeFailedError(outcome.httpStatus, outcome.message);

  return { status: outcome.status, body: outcome.body };
}

/** Every refusal these routes raise, in the bodies this family has always answered. */
const healthProbeErrors: RestErrorHandler = (error, context) => {
  if (error instanceof HealthProbeFailedError) {
    return context.json({ message: error.message }, error.httpStatus);
  }

  if (
    error instanceof HealthProbeTokenMissingError ||
    error instanceof HealthProbeTokenInvalidError
  ) {
    return context.json({ message: error.message }, 401);
  }

  return context.json({ message: "Internal server error." }, 500);
};
