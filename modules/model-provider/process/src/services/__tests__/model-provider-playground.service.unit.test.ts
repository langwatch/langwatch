import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { AggregateProjectIsReadOnlyError, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderPlaygroundService } from "../model-provider-playground.service.ts";

const request = {
  projectId: "project-1",
  model: "openai/gpt-5-mini",
  systemPrompt: null,
  messages: [],
};

/** The project directory, answering every project as an ordinary one that accepts writes. */
const ordinaryProjects = () =>
  createApiFixture<ProjectApi>({ assertAcceptsWrites: async () => void 0 }, "ProjectApi");

function service(
  getExecutionProviders: ModelProviderApi["getExecutionProviders"],
  projects: ProjectApi = ordinaryProjects(),
) {
  return ModelProviderPlaygroundService.create({
    modelProviders: createApiFixture<ModelProviderApi>({ getExecutionProviders }),
    projects,
    executionProxyBaseUrl: "http://nlp.test/go/proxy/v1",
  });
}

describe("ModelProviderPlaygroundService", () => {
  it("keeps the provider-not-configured response at the app boundary", async () => {
    const result = await service(async () => ({})).execute(request);

    expect(result.status).toBe(400);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(new TextDecoder().decode((await result.body[Symbol.asyncIterator]().next()).value)).toBe(
      JSON.stringify({ error: "Provider not configured: openai" }),
    );
  });

  describe("when the project is an aggregate", () => {
    /** ADR-175 decision 8: nothing is run under an aggregate's tenant. */
    it("refuses with the read-only code before choosing a provider", async () => {
      const getExecutionProviders = vi.fn(async () => ({}));
      const projects = createApiFixture<ProjectApi>(
        {
          assertAcceptsWrites: async () => {
            throw new AggregateProjectIsReadOnlyError();
          },
        },
        "ProjectApi",
      );

      await expect(service(getExecutionProviders, projects).execute(request)).rejects.toMatchObject(
        { code: "aggregate_project_is_read_only" },
      );
      expect(getExecutionProviders).not.toHaveBeenCalled();
    });
  });

  describe("when the project is an ordinary one", () => {
    it("asks the project, then goes on to choose a provider", async () => {
      const getExecutionProviders = vi.fn(async () => ({}));
      const assertAcceptsWrites = vi.fn(async () => void 0);

      await service(
        getExecutionProviders,
        createApiFixture<ProjectApi>({ assertAcceptsWrites }, "ProjectApi"),
      ).execute(request);

      expect(assertAcceptsWrites).toHaveBeenCalledWith({ projectId: "project-1" });
      expect(getExecutionProviders).toHaveBeenCalled();
    });
  });
});
