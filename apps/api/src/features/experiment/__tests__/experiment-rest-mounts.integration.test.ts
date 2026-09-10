import type { Experiment } from "@langwatch/experiment-contract";
import type { ExperimentService } from "@langwatch/experiment-server";
import { describe, expect, it, vi } from "vitest";

import { mountExperimentDspyStepsRest } from "../experiment-dspy-steps-rest.mount.ts";
import { mountExperimentRest } from "../experiment-rest.mount.ts";
import type { HandlerManagedCredential } from "../../../app/api-handler-managed-credential.ts";
import {
  experimentApiRestRuntime,
  experimentApp,
  renderExperimentRestError,
  successfulCredential,
} from "./experiment-rest.fixture.ts";

const EXPERIMENT: Experiment = {
  id: "experiment-1",
  projectId: "project-1",
  slug: "nightly-sweep",
  name: "Nightly sweep",
  type: "DSPY",
  workflowId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 0,
};

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("given the standard experiment REST mount", () => {
  describe("when a project key lists its experiments", () => {
    it("serves the declaration through the process runtime and keeps the project scope", async () => {
      const getPage = vi.fn(async () => ({ experiments: [EXPERIMENT], totalHits: 1 }));
      const { app } = experimentApp({
        getPage,
        getRunAggregates: async () => ({}),
      });
      const mounted = mountExperimentRest(experimentApiRestRuntime(), {
        experiments: () => app,
        errors: renderExperimentRestError,
      });

      const response = await mounted.fetch(new Request("http://api.test/api/experiments"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        experiments: [{ id: "experiment-1", slug: "nightly-sweep" }],
      });
      expect(getPage).toHaveBeenCalledWith({ projectId: "project-1", page: 1, pageSize: 50 });
    });
  });
});

describe("given the DSPy step REST mount", () => {
  describe("when a key that may manage experiments posts one step", () => {
    it("binds the pinned permission and stores the step in the resolved project", async () => {
      const upsertDspyStep = vi.fn(async () => {});
      const experiments: Partial<ExperimentService> = {
        findBySlug: async () => EXPERIMENT,
        upsertDspyStep,
      };
      const { app } = experimentApp(experiments);
      const credential = vi.fn(async () => successfulCredential());
      const mounted = mountExperimentDspyStepsRest(experimentApiRestRuntime(), {
        experiments: () => app,
        credential,
        errors: renderExperimentRestError,
      });

      const response = await mounted.fetch(
        new Request(
          "http://api.test/api/dspy/log_steps",
          jsonPost([
            {
              run_id: "run-1",
              index: "1",
              score: 0.9,
              label: "candidate",
              optimizer: { name: "MIPROv2", parameters: {} },
              predictors: [],
              examples: [],
              llm_calls: [],
              timestamps: { created_at: 1_700_000_000_000 },
              experiment_slug: "nightly-sweep",
            },
          ]),
        ),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "ok" });
      expect(credential).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "experiments:manage" }),
      );
      expect(upsertDspyStep).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project-1", experimentId: "experiment-1" }),
      );
    });
  });

  describe("when the project credential refuses the management ceiling", () => {
    it("preserves the exact refusal status and body before the application runs", async () => {
      const findOrCreateForRun = vi.fn();
      const { app } = experimentApp({ findOrCreateForRun });
      const refusal: HandlerManagedCredential = {
        ok: false,
        status: 403,
        body: { error: "api_key_permission_denied", permission: "experiments:manage" },
      };
      const mounted = mountExperimentDspyStepsRest(experimentApiRestRuntime(), {
        experiments: () => app,
        credential: async () => refusal,
        errors: renderExperimentRestError,
      });

      const response = await mounted.fetch(
        new Request("http://api.test/api/dspy/log_steps", jsonPost([])),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual(refusal.body);
      expect(findOrCreateForRun).not.toHaveBeenCalled();
    });
  });
});
