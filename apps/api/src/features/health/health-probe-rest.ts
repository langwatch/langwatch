/**
 * The project-keyed door onto the five subsystem probes, which live in
 * `@langwatch/platform-health-server`.
 * @see packages/features/platform-health/specs/platform-health.feature
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  SubsystemProbeService,
  type SubsystemProbeOutcome,
} from "@langwatch/platform-health-server";
import { fromDate } from "@langwatch/time";
import type { Context } from "hono";

/** One project, as a probe's key resolves to it. */
export type HealthProbeProject = Readonly<{ id: string }>;

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

type ProbeAuth =
  | { readonly error: string; readonly status: 401 }
  | { readonly project: HealthProbeProject; readonly authToken: string };

async function authenticateProject(
  c: Pick<Context, "req">,
  ports: HealthProbeRestPorts,
): Promise<ProbeAuth> {
  const xAuthToken = c.req.header("x-auth-token");
  const authHeader = c.req.header("authorization");
  const authToken = xAuthToken ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return {
      error:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      status: 401 as const,
    };
  }

  const project = await ports.resolveProjectByApiKey(authToken);

  if (!project) {
    return { error: "Invalid auth token.", status: 401 as const };
  }

  return { project, authToken };
}

/** The one body shape every probe has always answered with. */
function render(c: Context, outcome: SubsystemProbeOutcome): Response {
  return outcome.ok
    ? c.json({ status: outcome.status, body: outcome.body })
    : c.json({ message: outcome.message }, { status: outcome.httpStatus });
}

/** `/api/health/*`, bound to one process. */
export function createHealthProbeRestApp(options: {
  security: AppRestSecurity;
  ports: HealthProbeRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  // No `/api/v1` twin: the probes are the deployment's own surface, not the
  // published product API, and an orchestrator's probe URL is configuration.
  const secured = security.createServiceApp({ basePath: "/api/health", v1Alias: false });
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

  // Authenticates a project API key and authorizes nothing of its own: every
  // privileged action a canary takes is a separate authenticated request the
  // same key must itself be allowed to make.
  const probe = handlerManagedAuth({
    reason:
      "project API key resolved in-handler from X-Auth-Token or Authorization: Bearer; the canary's own requests carry the same key and are authorized on their own routes",
    permissions: [],
    credential: "apiKey",
  });

  const withProject = async (
    c: Context,
    run: (auth: {
      project: HealthProbeProject;
      authToken: string;
    }) => Promise<SubsystemProbeOutcome>,
  ): Promise<Response> => {
    const auth = await authenticateProject(c, ports);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    return render(c, await run(auth));
  };

  secured
    .access(probe)
    .get("/collector", (c) =>
      withProject(c, ({ authToken }) => probes.runCollector({ authToken })),
    );
  secured
    .access(probe)
    .get("/evaluations", (c) =>
      withProject(c, ({ authToken }) => probes.runEvaluations({ authToken })),
    );
  secured
    .access(probe)
    .get("/processor", (c) =>
      withProject(c, ({ authToken }) => probes.runProcessor({ authToken })),
    );
  secured
    .access(probe)
    .get("/triggers", (c) =>
      withProject(c, ({ project }) =>
        probes.runTriggers({ projectId: project.id, triggerId: c.req.query("triggerId") ?? "" }),
      ),
    );
  secured.access(probe).get("/workflows", (c) =>
    withProject(c, ({ project, authToken }) =>
      probes.runWorkflows({
        projectId: project.id,
        workflowId: c.req.query("workflowId") ?? "",
        authToken,
      }),
    ),
  );

  return secured.mountable;
}
