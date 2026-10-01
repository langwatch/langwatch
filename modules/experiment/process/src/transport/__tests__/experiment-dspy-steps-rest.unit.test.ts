/**
 * Tests POST /api/dspy/log_steps behind the project door: credential refusals and a body past
 * its cap as handled errors, and an accepted batch stored under the key's project.
 * @vitest-environment node
 */
import { ProjectMissingCredentialsError } from "@langwatch/api";
import {
  canonicalErrorResponse,
  createRestRuntime,
  restRouteDocumentation,
} from "@langwatch/api/rest";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { experimentDspyStepsRest } from "../experiment-dspy-steps.rest.ts";
import { stubExperimentApi } from "./experiment-rest.harness.ts";

const PROJECT_ID = "project-1";
const GOOD_KEY = "sk-lw-good";
const MAX_BODY_BYTES = 20 * 1024 * 1024;

/** The key ceiling as the credential port raises it; this module may not import its owner. */
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
function mountLogSteps({
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
        if (request.headers.get("Authorization") !== `Bearer ${GOOD_KEY}`) {
          throw new ProjectMissingCredentialsError();
        }
        if (!granted.includes(permission)) throw new KeyCeilingDenied(permission);

        return {
          actor: { type: "api_key", id: "key-1" },
          scope: { tier: "project", id: PROJECT_ID },
        };
      },
    },
  });

  const hono = runtime.mount(experimentDspyStepsRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });

  return (body: string, key: string | null = GOOD_KEY) =>
    hono.fetch(
      new Request("http://api.test/api/dspy/log_steps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
        },
        body,
      }),
    );
}

describe("given the DSPy optimizer's step log door", () => {
  describe("when the request carries no project key", () => {
    it("refuses at 401 with the missing-credentials code and reads nothing", async () => {
      const listModelCosts = vi.fn();
      const send = mountLogSteps({ stubs: { listModelCosts } });

      const response = await send("[]", null);

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: new ProjectMissingCredentialsError().code,
      });
      expect(listModelCosts).not.toHaveBeenCalled();
    });
  });

  describe("when the key may not manage experiments", () => {
    it("refuses at 403 with the ceiling's code and the permission it lacks", async () => {
      const listModelCosts = vi.fn();
      const send = mountLogSteps({ stubs: { listModelCosts }, granted: [] });

      const response = await send("[]");

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "api_key_permission_denied",
        meta: { permission: "experiments:manage" },
      });
      expect(listModelCosts).not.toHaveBeenCalled();
    });
  });

  describe("when the body is past its cap", () => {
    it("refuses at 413 with the payload-too-large code", async () => {
      const send = mountLogSteps({ stubs: {} });

      const response = await send(" ".repeat(MAX_BODY_BYTES + 1));

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "payload_too_large" });
    });
  });

  describe("when the body is not valid JSON", () => {
    it("refuses at 422 with the validation code and stores nothing", async () => {
      const listModelCosts = vi.fn();
      const send = mountLogSteps({ stubs: { listModelCosts } });

      const response = await send("[not json");

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(listModelCosts).not.toHaveBeenCalled();
    });
  });

  describe("when the body is not a batch of steps", () => {
    it("refuses at 422 with the validation code and stores nothing", async () => {
      const listModelCosts = vi.fn();
      const send = mountLogSteps({ stubs: { listModelCosts } });

      const response = await send(JSON.stringify({ steps: [] }));

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(listModelCosts).not.toHaveBeenCalled();
    });
  });

  describe("when storing a step fails for a reason nobody handled", () => {
    it("answers the generic unknown error, never the underlying detail", async () => {
      const send = mountLogSteps({
        stubs: {
          listModelCosts: async () => {
            throw new Error("connection to db-7.internal refused");
          },
        },
      });

      const response = await send("[]");
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toMatchObject({ code: "internal_error" });
      expect(JSON.stringify(body)).not.toContain("db-7.internal");
    });
  });

  describe("when a key that may manage experiments sends a batch", () => {
    it("stores it under the key's own project and answers ok", async () => {
      const listModelCosts = vi.fn(async () => []);
      const send = mountLogSteps({ stubs: { listModelCosts } });

      const response = await send("[]");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: "ok" });
      expect(listModelCosts).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    });
  });

  describe("when the route is published", () => {
    it("states the project key it enforces, not an open door", () => {
      const declaration = experimentDspyStepsRest.router();

      expect(
        declaration.routes.map(
          (route) => restRouteDocumentation({ route, credential: declaration.credential }).security,
        ),
      ).toEqual([[{ project_api_key: [] }]]);
    });
  });
});
