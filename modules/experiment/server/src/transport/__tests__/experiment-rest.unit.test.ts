/**
 * `/api/experiments` - the behaviours the family answered before it was
 * rewritten against the declaration builder, ported by behaviour from the
 * transport test that stood beside the deleted imperative one.
 *
 * Spec: modules/experiment/specs/experiment-service.feature.
 * @vitest-environment node
 */
import type { Experiment } from "@langwatch/experiment-contract";
import { describe, expect, it, vi } from "vitest";

import {
  AS_LEGACY_KEY,
  AS_MEMBER,
  CALLER_USER_ID,
  mountExperimentRest,
  PROJECT_ID,
} from "./experiment-rest.harness.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const experiment = {
  id: "experiment-1",
  projectId: PROJECT_ID,
  slug: "support-email-classifier",
  name: "Support email classifier",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Experiment;

const listing = {
  getPage: vi.fn(async () => ({ experiments: [experiment], totalHits: 1 })),
  withRunAggregates: vi.fn(async () => [
    { experiment, runsCount: 3, lastRunAt: 1_700_000_000_000 },
  ]),
};

describe("given the project's experiments over REST", () => {
  describe("when the listing is read", () => {
    it("answers each entry with its identifiers, its type and its run aggregates", async () => {
      const { send } = mountExperimentRest({ app: { ...listing } });

      const response = await send("/api/experiments");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        experiments: [
          {
            id: "experiment-1",
            slug: "support-email-classifier",
            type: "EVALUATIONS_V3",
            runsCount: 3,
          },
        ],
        pagination: { page: 1, pageSize: 50, totalHits: 1, hasMore: false },
      });
    });

    it("reads the project off the credential, never off the request", async () => {
      const getPage = vi.fn(async () => ({ experiments: [], totalHits: 0 }));
      const { send } = mountExperimentRest({
        app: { getPage, withRunAggregates: async () => [] },
      });

      await send("/api/experiments?projectId=someone-elses-project");

      expect(getPage).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT_ID }));
    });

    it("takes the page window from the query string", async () => {
      const getPage = vi.fn(async () => ({ experiments: [], totalHits: 0 }));
      const { send } = mountExperimentRest({
        app: { getPage, withRunAggregates: async () => [] },
      });

      await send("/api/experiments?page=3&pageSize=10");

      expect(getPage).toHaveBeenCalledWith({ projectId: PROJECT_ID, page: 3, pageSize: 10 });
    });

    it("caps the page size and falls back on a window that is not a positive number", async () => {
      const getPage = vi.fn(async () => ({ experiments: [], totalHits: 0 }));
      const { send } = mountExperimentRest({
        app: { getPage, withRunAggregates: async () => [] },
      });

      await send("/api/experiments?page=nonsense&pageSize=100000");

      expect(getPage).toHaveBeenCalledWith({ projectId: PROJECT_ID, page: 1, pageSize: 200 });
    });

    it("reports more pages while the window has not reached the total", async () => {
      const { send } = mountExperimentRest({
        app: {
          getPage: async () => ({ experiments: [experiment], totalHits: 9 }),
          withRunAggregates: async () => [
            { experiment, runsCount: 0, lastRunAt: null },
          ],
        },
      });

      const body = (await (await send("/api/experiments")).json()) as {
        pagination: { hasMore: boolean };
      };

      expect(body.pagination.hasMore).toBe(true);
    });
  });

  describe("when one experiment is read", () => {
    it("answers the same row shape the list puts in its array", async () => {
      const { send } = mountExperimentRest({
        app: {
          getBySlugOrId: async () => experiment,
          withRunAggregates: async () => [
            { experiment, runsCount: 3, lastRunAt: 1_700_000_000_000 },
          ],
        },
      });

      const response = await send("/api/experiments/support-email-classifier");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: "experiment-1",
        slug: "support-email-classifier",
        runsCount: 3,
      });
    });

    it("looks the slug up only inside the credential's project", async () => {
      const getBySlugOrId = vi.fn(async () => experiment);
      const { send } = mountExperimentRest({
        app: { getBySlugOrId, withRunAggregates: async () => [] },
      });

      await send("/api/experiments/support-email-classifier");

      expect(getBySlugOrId).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        slugOrId: "support-email-classifier",
      });
    });

    it("accepts the id as well, because the same list row carries both", async () => {
      const getBySlugOrId = vi.fn(async () => experiment);
      const { send } = mountExperimentRest({
        app: { getBySlugOrId, withRunAggregates: async () => [] },
      });

      await send("/api/experiments/experiment-1");

      expect(getBySlugOrId).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        slugOrId: "experiment-1",
      });
    });
  });

  describe("when an experiment is created", () => {
    const created = {
      createEvaluationsV3: vi.fn(async () => ({
        experimentId: "experiment-1",
        slug: "support-email-classifier",
        version: 1,
      })),
    };

    it("answers the identifiers every other endpoint takes", async () => {
      const { send } = mountExperimentRest({ app: { ...created } });

      const response = await send("/api/experiments", { method: "POST", body: {} });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: "experiment-1",
        slug: "support-email-classifier",
        version: 1,
      });
    });

    it("attributes the write to the member a scoped credential acts as", async () => {
      const createEvaluationsV3 = vi.fn(async () => ({
        experimentId: "experiment-1",
        slug: "s",
        version: 1,
      }));
      const { send } = mountExperimentRest({ app: { createEvaluationsV3 } });

      await send("/api/experiments", { method: "POST", body: {}, as: AS_MEMBER });

      expect(createEvaluationsV3).toHaveBeenCalledWith(expect.anything(), {
        kind: "credential",
        credential: { kind: "apiKey", userId: CALLER_USER_ID },
      });
    });

    it("attributes a legacy project key to the surface rather than to a person", async () => {
      const createEvaluationsV3 = vi.fn(async () => ({
        experimentId: "experiment-1",
        slug: "s",
        version: 1,
      }));
      const { send } = mountExperimentRest({ app: { createEvaluationsV3 } });

      await send("/api/experiments", { method: "POST", body: {}, as: AS_LEGACY_KEY });

      expect(createEvaluationsV3).toHaveBeenCalledWith(expect.anything(), {
        kind: "credential",
        credential: { kind: "legacyProjectKey" },
      });
    });

    it("sends no setup when the caller sent none, leaving the default to the application", async () => {
      const createEvaluationsV3 = vi.fn(async () => ({
        experimentId: "experiment-1",
        slug: "s",
        version: 1,
      }));
      const { send } = mountExperimentRest({ app: { createEvaluationsV3 } });

      await send("/api/experiments", { method: "POST", body: {} });

      expect(createEvaluationsV3).toHaveBeenCalledWith({ projectId: PROJECT_ID }, expect.anything());
    });

    // WIRE DELTA: the imperative family answered 400 here. The declaration
    // runtime parses the body itself and raises `validation_error`, which
    // carries 422 and names the offending field in `meta.fields` - strictly
    // more for a caller to act on than the bare 400 it replaces.
    it("refuses an empty name before the application is touched", async () => {
      const createEvaluationsV3 = vi.fn();
      const { send } = mountExperimentRest({ app: { createEvaluationsV3 } });

      const response = await send("/api/experiments", { method: "POST", body: { name: "" } });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: "validation_error" });
      expect(createEvaluationsV3).not.toHaveBeenCalled();
    });
  });

  describe("when the caller presents no usable credential", () => {
    it("is refused before any handler runs", async () => {
      const getPage = vi.fn();
      const { send } = mountExperimentRest({ app: { getPage } });

      const response = await send("/api/experiments", { as: "nobody-issued-this" });

      expect(response.status).toBe(401);
      expect(getPage).not.toHaveBeenCalled();
    });

    it("authenticates before it authorizes", async () => {
      const checked: string[] = [];
      const { send } = mountExperimentRest({
        app: { getPage: async () => ({ experiments: [], totalHits: 0 }), withRunAggregates: async () => [] },
        checked,
      });

      await send("/api/experiments");

      expect(checked).toEqual(["authenticate", "authorize:experiments:view"]);
    });

    it("refuses a create the credential holds no permission for", async () => {
      const createEvaluationsV3 = vi.fn();
      const { send } = mountExperimentRest({
        app: { createEvaluationsV3 },
        granted: ["experiments:view"],
      });

      const response = await send("/api/experiments", { method: "POST", body: {} });

      expect(response.status).toBe(403);
      expect(createEvaluationsV3).not.toHaveBeenCalled();
    });
  });
});
