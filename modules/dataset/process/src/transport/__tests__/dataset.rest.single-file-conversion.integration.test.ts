/**
 * @vitest-environment node
 * A single-file dataset read through the REST routes before and after the conversion step:
 * the same records, with the same ids and entries, now from object-storage chunks.
 */
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  projectRequestContext,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDatasetTestApp } from "../../app/__tests__/dataset.fixture.ts";
import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { DatasetSingleFileConversionService } from "../../services/dataset-single-file-conversion.service.ts";
import { createDatasetRest } from "../dataset.rest.ts";

const PROJECT = "project-1";

describe("given a single-file dataset with 3 records", () => {
  describe("when the single-file conversion step runs", () => {
    /** @scenario "A converted dataset reads the same through the REST API" */
    it("returns the same 3 records with the same ids and entries through the REST API", async () => {
      const repositories = MemoryDatasetRepositories.create();
      const dataset = await repositories.content.create({
        projectId: PROJECT,
        name: "legacy-questions",
        slug: "legacy-questions",
        columnTypes: [{ name: "question", type: "string" }],
        contentLayout: "postgres",
        useS3: true,
        s3RecordCount: 3,
      });
      await repositories.singleFiles.putSingleFile({
        projectId: PROJECT,
        datasetId: dataset.id,
        text: JSON.stringify(
          ["one", "two", "three"].map((question, index) => ({
            id: `r${index + 1}`,
            entry: { question },
            datasetId: dataset.id,
            projectId: PROJECT,
          })),
        ),
      });
      const send = mount(repositories);
      const read = async () => {
        const response = await send("GET", "/api/dataset/legacy-questions");
        expect(response.status).toBe(200);
        const body = (await response.json()) as { data: { id: string; entry: unknown }[] };
        return body.data.map((record) => [record.id, record.entry]);
      };
      const before = await read();

      await DatasetSingleFileConversionService.create({
        conversion: repositories.singleFileConversion,
        datasets: repositories.content,
        files: repositories.singleFiles,
        chunks: repositories.chunks,
        projects: createApiFixture<ProjectApi>({
          listAllIds: async () => ({ ids: [PROJECT], next: null }),
        }),
      }).run();

      expect(
        (await repositories.content.getOne({ id: dataset.id, projectId: PROJECT })).contentLayout,
      ).toBe("s3_jsonl");
      expect(before).toEqual([
        ["r1", { question: "one" }],
        ["r2", { question: "two" }],
        ["r3", { question: "three" }],
      ]);
      expect(await read()).toEqual(before);
    });
  });
});

function mount(repositories: ReturnType<typeof MemoryDatasetRepositories.create>) {
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
  return (method: string, path: string) => hono.request(path, { method });
}
