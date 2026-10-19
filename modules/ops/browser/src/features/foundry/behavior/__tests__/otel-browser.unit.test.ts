/**
 * The Foundry page loads this module in the browser: a module that will
 * not resolve or parse takes `/ops/foundry` down entirely. Building a
 * provider here exercises the whole chain. Spec: specs/ops/foundry-trace-playground.feature
 */
import { describe, expect, it } from "vitest";

import { createFoundryProvider } from "../otel-browser.ts";

describe("given the Foundry's browser exporter", () => {
  describe("when a legacy project key names its project", () => {
    /** @scenario "The Foundry's browser exporter is loadable on the page that mounts it" */
    it("builds a provider over the deployment's own collector", () => {
      const provider = createFoundryProvider({
        apiKey: "pat-lw-example",
        endpoint: "https://app.langwatch.test",
        projectId: "project-1",
        resourceAttributes: { "service.name": "foundry-test" },
      });

      expect(provider.getTracer("foundry")).toBeDefined();
    });
  });
});
