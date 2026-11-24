/**
 * @vitest-environment node
 * The REST routes mounted over the real dataset app and its memory twins: a dataset created
 * and filled through the public API answers with the same record shape, and its rows are in
 * object storage, not the records table.
 */
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  projectRequestContext,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDatasetTestApp } from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetRepositories } from "../../repositories/dataset.repositories.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { createDatasetRest } from "../dataset.rest.ts";

const PROJECT = "project-1";

function mount(repositories: DatasetRepositories) {
  const app = createDatasetTestApp({ repositories, publicBaseUrl: "https://app.langwatch.test" });
  const refuse = () => {
    throw new UnauthorizedError();
  };
  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    audit: { record: () => {} },
    rateLimiter: { check: async () => ({ allowed: true }) },
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: PROJECT },
      }),
    },
    doors: { browser: { authenticate: refuse, identify: refuse, authorize: refuse } },
  });
  const hono = runtime.mount(createDatasetRest().router(), {
    app: () => app,
    credential: "project",
    onError: canonicalErrorResponse,
    middlewareContext: [
      bindMiddlewareContext(projectRequestContext, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "user-1",
      })),
    ],
  });

  return (method: string, path: string, body?: unknown) =>
    hono.request(path, {
      method,
      ...(body === void 0
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
}

describe("given an API key for a project", () => {
  describe("when a dataset is created through the REST API and given two rows with their own ids", () => {
    /** @scenario "A dataset created with rows through the public API answers exactly as before" */
    it("reads them back with the same ids and entries, and keeps none in the records table", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const send = mount(repositories);
      const columnTypes = [
        { name: "input", type: "string" },
        { name: "output", type: "string" },
      ];

      const created = await send("POST", "/api/dataset", { name: "support-tickets", columnTypes });
      expect(created.status).toBe(201);
      const added = await send("POST", "/api/dataset/support-tickets/records", {
        entries: [
          { id: "ticket-1", input: "Where is my order?", output: "On its way." },
          { id: "ticket-2", input: "Can I return it?", output: "Within 30 days." },
        ],
      });
      expect(added.status).toBe(201);

      const read = await send("GET", "/api/dataset/support-tickets");
      expect(read.status).toBe(200);
      const body = (await read.json()) as { id: string; data: Record<string, unknown>[] };
      expect(body.data.map((record) => [record.id, record.entry])).toEqual([
        ["ticket-1", { input: "Where is my order?", output: "On its way." }],
        ["ticket-2", { input: "Can I return it?", output: "Within 30 days." }],
      ]);
      for (const record of body.data) {
        expect(Object.keys(record).toSorted()).toEqual([
          "createdAt",
          "datasetId",
          "entry",
          "id",
          "projectId",
          "updatedAt",
        ]);
        expect(record).toMatchObject({ datasetId: body.id, projectId: PROJECT });
      }
      await expect(
        repositories.records.count({ datasetId: body.id, projectId: PROJECT }),
      ).resolves.toBe(0);
    });
  });
});
