import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LangWatch,
  ProjectsApiService,
  TeamsApiService,
} from "../index";

/**
 * Teams and projects are how an integration provisions the tenant it is
 * about to write to, so they belong on the client the same way every other
 * service does. Both are built on first use: the management families resolve
 * their credential when constructed and refuse an empty one.
 */
describe("management services on the client SDK entry point", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;

  beforeEach(() => {
    delete process.env.LANGWATCH_API_KEY;
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env.LANGWATCH_API_KEY;
    } else {
      process.env.LANGWATCH_API_KEY = previousApiKey;
    }
  });

  it("exports both management service classes", () => {
    expect(TeamsApiService).toBeTypeOf("function");
    expect(ProjectsApiService).toBeTypeOf("function");
  });

  describe("when the client is built with an API key", () => {
    /** @scenario Teams and projects are reachable from the SDK entry point */
    it("exposes teams and projects, memoizing each one", () => {
      const client = new LangWatch({
        apiKey: "test-org-key",
        endpoint: "http://localhost:5560",
      });

      expect(client.teams).toBeInstanceOf(TeamsApiService);
      expect(client.projects).toBeInstanceOf(ProjectsApiService);
      expect(client.teams).toBe(client.teams);
      expect(client.projects).toBe(client.projects);
    });
  });

  describe("when no API key is configured", () => {
    it("still constructs the client, and names the missing credential on use", () => {
      const client = new LangWatch({ endpoint: "http://localhost:5560" });

      expect(() => client.teams).toThrow(/No API key configured/);
    });
  });
});
