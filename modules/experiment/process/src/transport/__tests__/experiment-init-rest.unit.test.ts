/**
 * Tests POST /api/experiment/init behind the project door: credential refusals in main's flat
 * bodies, the door's own sentences, and success.
 * @vitest-environment node
 */
import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "@langwatch/api";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  restRouteDocumentation,
} from "@langwatch/api/rest";
import type { Experiment, ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { experimentInitRest } from "../experiment-init.rest.ts";
import { stubExperimentApi } from "./experiment-rest.harness.ts";

const PROJECT_ID = "project-1";
const PROJECT_SLUG = "project-one";
const GOOD_KEY = "sk-lw-good";

const experiment: Experiment = {
  id: "experiment-1",
  projectId: PROJECT_ID,
  slug: "nightly-regression",
  name: null,
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 0,
};

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

/** The key ceiling as the credential port raises it, declared here for the same reason. */
class KeyCeilingDenied extends HandledError {
  declare readonly code: "api_key_permission_denied";

  constructor(permission: string) {
    super("api_key_permission_denied", "This API key may not do that", {
      httpStatus: 403,
      meta: { permission },
    });
    this.name = "KeyCeilingDenied";
  }
}

/** The door over one experiment application, behind a project door granting `granted`. */
function mountInit({
  stubs,
  granted = ["experiments:manage"],
}: {
  stubs: Partial<ExperimentApi>;
  granted?: readonly string[];
}) {
  const app = stubExperimentApi(stubs);

  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request, permission }) => {
        const presented = request.headers.get("Authorization");
        if (!presented) throw new ProjectMissingCredentialsError();
        if (presented !== `Bearer ${GOOD_KEY}`) throw new ProjectInvalidCredentialsError();
        if (!granted.includes(permission)) throw new KeyCeilingDenied(permission);

        return {
          actor: { type: "api_key", id: "key-1" },
          scope: { tier: "project", id: PROJECT_ID },
        };
      },
    },
  });

  const hono = runtime.mount(experimentInitRest.router(), {
    app: () => app,
    // The family's boundary: a door that renders its own refusals never reaches it.
    onError: (_error, c) => c.json({ boundary: "family" }, 500),
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: PROJECT_SLUG,
        viewerUserId: null,
        actorId: "key-1",
      })),
    ],
  });

  return (body: string, key: string | null = GOOD_KEY) =>
    hono.fetch(
      new Request("http://api.test/api/experiment/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
        },
        body,
      }),
    );
}

const FREE_SLUG = JSON.stringify({ experiment_slug: "nightly", experiment_type: "DSPY" });

describe("given the SDK's experiment create-or-take door", () => {
  describe("when the request carries no project key", () => {
    /** @scenario "A create-or-take call with no credential is refused before the body is read" */
    it("refuses at 401 with main's flat body naming the headers a token may be sent in", async () => {
      const findOrCreateForRun = vi.fn();
      const send = mountInit({ stubs: { findOrCreateForRun } });

      const response = await send(FREE_SLUG, null);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Unauthorized",
        message: new ProjectMissingCredentialsError().message,
      });
      expect(findOrCreateForRun).not.toHaveBeenCalled();
    });
  });

  describe("when the project key is not one the deployment knows", () => {
    it("refuses at 401 with main's flat body", async () => {
      const send = mountInit({ stubs: {} });

      const response = await send(FREE_SLUG, "sk-lw-unknown");

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Unauthorized",
        message: new ProjectInvalidCredentialsError().message,
      });
    });
  });

  describe("when the key may not manage experiments", () => {
    /** @scenario "A key without permission to manage experiments is refused as sent" */
    it("refuses at 403 with the ceiling's code and meta spread flat", async () => {
      const findOrCreateForRun = vi.fn();
      const send = mountInit({ stubs: { findOrCreateForRun }, granted: [] });

      const response = await send(FREE_SLUG);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "api_key_permission_denied",
        message: "This API key may not do that",
        permission: "experiments:manage",
        fault: "customer",
      });
      expect(findOrCreateForRun).not.toHaveBeenCalled();
    });
  });

  describe("when storing the experiment fails for a reason nobody handled", () => {
    it("answers main's bare 500 sentence, not the family's envelope", async () => {
      const send = mountInit({
        stubs: {
          findOrCreateForRun: async () => {
            throw new Error("connection to db-7.internal refused");
          },
        },
      });

      const response = await send(FREE_SLUG);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
    });
  });

  describe("when the route is published", () => {
    it("states the project key it enforces, not an open door", () => {
      const declaration = experimentInitRest.router();

      expect(
        declaration.routes.map(
          (route) => restRouteDocumentation({ route, credential: declaration.credential }).security,
        ),
      ).toEqual([[{ project_api_key: [] }]]);
    });
  });

  describe("when the body is not valid JSON", () => {
    /** @scenario "A body that is not valid JSON gets the door's own bare sentence" */
    it("refuses at 400 with a message field and no validation report", async () => {
      const findOrCreateForRun = vi.fn();
      const send = mountInit({ stubs: { findOrCreateForRun } });

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
      const send = mountInit({ stubs: { findOrCreateForRun } });

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
        stubs: {
          findOrCreateForRun: async () => {
            throw new PlanLimitReached();
          },
        },
      });

      const response = await send(FREE_SLUG);

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
      const send = mountInit({ stubs: { findOrCreateForRun } });

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
