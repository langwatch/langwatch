/**
 * `POST /api/experiment/init` — the four refusals and the one success this
 * door owns. Each body is a shape an SDK parses, so the assertions are on the
 * body as well as the status.
 *
 * The door declares handler-managed auth, so the two credential refusals (no
 * token, and a key without `experiments:manage`) are the process's credential
 * port answering, not this family: they are covered where that port is bound.
 *
 * Spec: modules/experiment/specs/experiment-service.feature.
 * @vitest-environment node
 */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import type { Experiment, ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { experimentInitCaller, experimentInitRest } from "../experiment-init.rest.ts";

const PROJECT_ID = "project-1";
const PROJECT_SLUG = "project-one";

const experiment = { id: "experiment-1", slug: "nightly-regression" } as unknown as Experiment;

/**
 * The plan refusal as the licensing layer raises it. Declared here rather than
 * imported: this module may not reach the enterprise package, which is the
 * same reason the door matches on the CODE.
 */
class PlanLimitReached extends HandledError {
  declare readonly code: "resource_limit_exceeded";

  constructor() {
    super("resource_limit_exceeded", "Experiment limit reached", {
      httpStatus: 403,
      meta: { limitType: "experiments", current: 10, max: 10 },
    });
    this.name = "PlanLimitReached";
  }
}

/** The door over one experiment application, with its caller already resolved. */
function mountInit(stubs: Partial<ExperimentApi>) {
  const app = new Proxy({} as ExperimentApi, {
    get(_target, property) {
      const stubbed: unknown = Reflect.get(stubs, property);
      if (stubbed !== undefined) return stubbed;

      return () => {
        throw new Error(`ExperimentApi.${String(property)} was not stubbed by this test`);
      };
    },
  });

  const runtime = createRestRuntime({
    identity: {
      // The door defers its scope: the process's credential port has already
      // resolved the project and enforced the key's ceiling, so the runtime
      // only identifies the caller.
      identify: () => ({ actor: { type: "api_key", id: "key-1" }, scope: null }),
      // Never reached: the route defers its scope, so the runtime identifies
      // rather than authenticating. Supplied because the port declares both.
      authenticate: () => {
        throw new Error("a deferred route must not authenticate at the door");
      },
    },
  });

  const hono = runtime.mount(experimentInitRest.router(), {
    app: () => app,
    onError: (error, c) => c.json({ error: "Internal server error" }, 500),
    facts: [
      bindRestMiddleware(experimentInitCaller, () => ({
        projectId: PROJECT_ID,
        projectSlug: PROJECT_SLUG,
      })),
    ],
  });

  return (body: string) =>
    hono.fetch(
      new Request("http://api.test/api/experiment/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
}

describe("given the SDK's experiment create-or-take door", () => {
  describe("when the body is not valid JSON", () => {
    /** @scenario "A body that is not valid JSON gets the door's own bare sentence" */
    it("refuses at 400 with a message field and no validation report", async () => {
      const findOrCreateForRun = vi.fn();
      const send = mountInit({ findOrCreateForRun });

      const response = await send("{not json");

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: "Bad request" });
      expect(findOrCreateForRun).not.toHaveBeenCalled();
    });
  });

  describe("when the body names neither identifier", () => {
    /** @scenario "A body naming neither identifier is refused with the validation sentence" */
    it("refuses at 400 with an error field carrying the schema's own sentence", async () => {
      const findOrCreateForRun = vi.fn();
      const send = mountInit({ findOrCreateForRun });

      const response = await send(JSON.stringify({ experiment_type: "DSPY" }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.any(String) });
      expect(findOrCreateForRun).not.toHaveBeenCalled();
    });
  });

  describe("when the plan's experiment limit is already reached", () => {
    /** @scenario "A plan whose experiment limit is reached is refused with the limit in the body" */
    it("refuses at 403 with the code, the limit type, the current count and the maximum", async () => {
      const send = mountInit({
        findOrCreateForRun: async () => {
          throw new PlanLimitReached();
        },
      });

      const response = await send(
        JSON.stringify({ experiment_slug: "nightly", experiment_type: "DSPY" }),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "resource_limit_exceeded",
        message: "Experiment limit reached",
        limitType: "experiments",
        current: 10,
        max: 10,
      });
    });
  });

  describe("when a key that may manage experiments names a free slug", () => {
    /** @scenario "A free slug creates the experiment and answers the app path" */
    it("creates the experiment and answers the app path built from the project's slug", async () => {
      const findOrCreateForRun = vi.fn(async () => experiment);
      const send = mountInit({ findOrCreateForRun });

      const response = await send(
        JSON.stringify({ experiment_slug: "nightly-regression", experiment_type: "DSPY" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        path: "/project-one/experiments/nightly-regression",
        slug: "nightly-regression",
      });
      expect(findOrCreateForRun).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, experimentSlug: "nightly-regression" }),
      );
    });
  });
});
