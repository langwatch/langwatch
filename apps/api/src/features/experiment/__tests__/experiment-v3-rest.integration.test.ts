/**
 * The experiment workbench's REST doors, driven through the real Hono app the API process
 * mounts.
 */
import type { WorkbenchStateView } from "@langwatch/experiment-contract";
import type { ExperimentService } from "@langwatch/experiment-server";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountExperimentV3Rest } from "../experiment-v3-rest.mount.ts";
import type { ApiHandlerManagedSessionPort } from "../../../app/api-handler-managed-session.ts";
import type { HandlerManagedCredential } from "../../../app/api-handler-managed-credential.ts";
import {
  experimentApiRestRuntime,
  experimentApp,
  experimentRun,
  renderExperimentRestError,
  successfulCredential,
} from "./experiment-rest.fixture.ts";

describe("given the workbench's saved-setup doors", () => {
  describe("when a project key that may view experiments reads a setup", () => {
    it("answers the application's own state and marks the key used", async () => {
      const markUsed = vi.fn();
      const getWorkbenchState = vi.fn(async () => workbench());
      const api = mount({ experiments: { getWorkbenchState }, markUsed });

      const response = await api.fetch("/api/experiments/acme/workbench-state");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: "experiment-1",
        slug: "acme",
        version: 3,
        name: "A workbench",
      });
      expect(getWorkbenchState).toHaveBeenCalledWith({ projectId: "project-1", slug: "acme" });
      expect(markUsed).toHaveBeenCalled();
    });
  });

  describe("when the key lacks the permission the door gates on", () => {
    it("answers the ceiling refusal as sent, without reading the application", async () => {
      const getWorkbenchState = vi.fn();
      const api = mount({
        experiments: { getWorkbenchState },
        credential: {
          ok: false,
          status: 403,
          body: { error: "insufficient_permissions", permission: "experiments:view" },
        },
      });

      const response = await api.fetch("/api/experiments/acme/workbench-state");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "insufficient_permissions",
        permission: "experiments:view",
      });
      expect(getWorkbenchState).not.toHaveBeenCalled();
    });
  });

  describe("when a restore names a version that is not a number", () => {
    it("answers the same not-found code a missing version gets, without writing", async () => {
      const restoreWorkbenchVersion = vi.fn();
      const api = mount({
        experiments: { getWorkbenchState: async () => workbench(), restoreWorkbenchVersion },
      });

      const response = await api.fetch("/api/experiments/acme/versions/3abc/restore", {
        method: "POST",
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "experiment_version_not_found",
      });
      expect(restoreWorkbenchVersion).not.toHaveBeenCalled();
    });
  });
});

describe("given a process that composed no run loop", () => {
  describe("when a CI job polls a run", () => {
    it("refuses by name at 503 rather than answering that the run does not exist", async () => {
      const api = mount({ runLoop: false });

      const response = await api.fetch("/api/experiments/runs/run-1");

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: "service_unavailable" });
    });
  });

  describe("when the same process reads a saved setup", () => {
    it("still answers, because the setup needs no run loop", async () => {
      const api = mount({
        runLoop: false,
        experiments: { getWorkbenchState: async () => workbench() },
      });

      const response = await api.fetch("/api/experiments/acme/workbench-state");

      expect(response.status).toBe(200);
    });
  });
});

describe("given the workbench's run doors", () => {
  describe("when a browser aborts a run owned by another project", () => {
    /** @scenario "A resource id from the body is verified against the authenticated tenant" */
    it("answers not-found rather than confirming the run exists elsewhere", async () => {
      const requestAbort = vi.fn(async () => {});
      const api = mount({
        abort: { findRunningProjectId: async () => "project-2", requestAbort },
      });

      const response = await api.fetch("/api/experiments/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", runId: "run-1" }),
      });

      expect(response.status).toBe(404);
      expect(requestAbort).not.toHaveBeenCalled();
    });
  });

  describe("when a browser aborts a run its own project owns", () => {
    /** @scenario "Project members can stop their own running workbench execution" */
    it("signals the stop through the composed abort port", async () => {
      const requestAbort = vi.fn(async () => {});
      const api = mount({
        abort: { findRunningProjectId: async () => "project-1", requestAbort },
      });

      const response = await api.fetch("/api/experiments/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", runId: "run-1" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ success: true, runId: "run-1" });
      expect(requestAbort).toHaveBeenCalledWith("run-1");
    });
  });

  describe("when nobody is signed in", () => {
    it("refuses the abort at 401 before any run is looked up", async () => {
      const findRunningProjectId = vi.fn();
      const api = mount({ session: null, abort: { findRunningProjectId } });

      const response = await api.fetch("/api/experiments/abort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", runId: "run-1" }),
      });

      expect(response.status).toBe(401);
      expect(findRunningProjectId).not.toHaveBeenCalled();
    });
  });

  describe("when a run list is asked for without naming an experiment", () => {
    it("refuses at 400 rather than listing every run in the project", async () => {
      const getRunsPageBySlug = vi.fn();
      const api = mount({ experiments: { getRunsPageBySlug } });

      const response = await api.fetch("/api/experiments/runs");

      expect(response.status).toBe(400);
      expect(getRunsPageBySlug).not.toHaveBeenCalled();
    });
  });
});

describe("given the family's older name", () => {
  it("re-dispatches `/api/evaluations/v3` into the canonical family", async () => {
    const getWorkbenchState = vi.fn(async () => workbench());
    const api = mount({ experiments: { getWorkbenchState } });

    const response = await api.fetch("/api/evaluations/v3/acme/workbench-state");

    expect(response.status).toBe(200);
    expect(getWorkbenchState).toHaveBeenCalledWith({ projectId: "project-1", slug: "acme" });
  });
});

// ---------------------------------------------------------------------------

function workbench(): WorkbenchStateView {
  return {
    experimentId: "experiment-1",
    slug: "acme",
    name: "A workbench",
    version: 3,
    updatedAt: new Date(0),
    state: { datasets: [], targets: [], evaluators: [] },
  };
}

type MountOptions = {
  experiments?: Partial<ExperimentService>;
  credential?: HandlerManagedCredential;
  markUsed?: () => void;
  session?: { user: { id: string } } | null;
  runLoop?: boolean;
  abort?: {
    findRunningProjectId: (runId: string) => Promise<string | null>;
    requestAbort?: () => Promise<void>;
  };
};

function mount(options: MountOptions = {}) {
  const session: ApiHandlerManagedSessionPort = {
    resolve: async () =>
      options.session === undefined ? { user: { id: "user-1" } } : options.session,
    permitted: async () => true,
  };

  const credential = options.credential ?? successfulCredential(options.markUsed);
  const { app } = experimentApp(options.experiments);
  const run = experimentRun({
    available: options.runLoop,
    findRunningProjectId: options.abort?.findRunningProjectId,
    requestAbort: options.abort?.requestAbort,
  });

  const hono = new Hono();
  for (const mounted of mountExperimentV3Rest(experimentApiRestRuntime(), {
    collaborators: {
      session,
      credential: async () => credential,
      experiments: () => app,
      run,
    },
    errors: renderExperimentRestError,
  })) {
    hono.route("/", mounted);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
