import { describe, expect, it } from "vitest";

import {
  assertObservabilityDoesNotSelfIngest,
  SelfIngestingObservabilityError,
} from "../self-ingest-guard";

const guard = (
  overrides: Partial<Parameters<typeof assertObservabilityDoesNotSelfIngest>[0]> = {},
): (() => void) => {
  const input = {
    runtime: "api",
    apiKeyEnv: "LANGWATCH_API_KEY",
    apiKey: "sk-lw-a-real-looking-key",
    endpointEnv: "LANGWATCH_ENDPOINT",
    endpoint: undefined as string | undefined,
    deployment: [{ env: "BASE_HOST", value: "https://app.example.test" }],
    ...overrides,
  };
  return () => assertObservabilityDoesNotSelfIngest(input);
};

describe("assertObservabilityDoesNotSelfIngest", () => {
  describe("given no observability API key", () => {
    /** @scenario "A process with no observability key boots whatever the endpoint says" */
    it("accepts a boot whose endpoint is this deployment", () => {
      expect(guard({ apiKey: undefined, endpoint: "https://app.example.test" })).not.toThrow();
    });

    it("treats a blank key as unset, because a blank export configured nothing", () => {
      expect(guard({ apiKey: "   ", endpoint: "https://app.example.test" })).not.toThrow();
    });
  });

  describe("given a key and an endpoint on another deployment", () => {
    /** @scenario "A process exporting to a different LangWatch install boots" */
    it("accepts the boot", () => {
      expect(guard({ endpoint: "https://app.langwatch.ai" })).not.toThrow();
    });

    it("accepts a second local instance on its own port", () => {
      expect(
        guard({
          endpoint: "http://localhost:5570",
          deployment: [{ env: "BASE_HOST", value: "http://localhost:5560" }],
        }),
      ).not.toThrow();
    });

    it("accepts another worktree's haven stack", () => {
      expect(
        guard({
          endpoint: "https://app.other.langwatch.localhost",
          deployment: [{ env: "BASE_HOST", value: "https://app.portless.langwatch.localhost" }],
        }),
      ).not.toThrow();
    });
  });

  describe("given a key and an endpoint that resolves to this deployment", () => {
    /** @scenario "A process pointed at its own ingest refuses to boot" */
    it("refuses a boot naming the same host", () => {
      expect(guard({ endpoint: "https://app.example.test" })).toThrow(
        SelfIngestingObservabilityError,
      );
    });

    it("refuses across a proxy's scheme, because one origin is one deployment", () => {
      expect(
        guard({
          endpoint: "http://app.example.test",
          deployment: [{ env: "BASE_HOST", value: "https://app.example.test" }],
        }),
      ).toThrow(SelfIngestingObservabilityError);
    });

    it("refuses an endpoint on the port this process listens at", () => {
      expect(
        guard({
          endpoint: "http://localhost:5560",
          deployment: [{ env: "API_HOST/API_PORT", value: "0.0.0.0", port: 5560 }],
        }),
      ).toThrow(SelfIngestingObservabilityError);
    });

    it("refuses a sibling service of the same worktree stack", () => {
      expect(
        guard({
          endpoint: "https://gateway.portless.langwatch.localhost",
          deployment: [{ env: "BASE_HOST", value: "https://app.portless.langwatch.localhost" }],
        }),
      ).toThrow(SelfIngestingObservabilityError);
    });

    it("refuses an unset endpoint whose SDK default is this deployment", () => {
      expect(
        guard({
          endpoint: undefined,
          deployment: [{ env: "BASE_HOST", value: "https://app.langwatch.ai" }],
        }),
      ).toThrow(SelfIngestingObservabilityError);
    });
  });

  describe("given a refusal an operator has to read", () => {
    /** @scenario "The refusal names the variables and never the key" */
    it("names both variables, the address and the deployment variable it matched", () => {
      let raised: SelfIngestingObservabilityError | undefined;
      try {
        guard({
          endpoint: "https://app.example.test",
          deployment: [{ env: "NEXTAUTH_URL", value: "https://app.example.test" }],
        })();
      } catch (error) {
        raised = error as SelfIngestingObservabilityError;
      }

      expect(raised?.message).toContain("LANGWATCH_API_KEY");
      expect(raised?.message).toContain("LANGWATCH_ENDPOINT");
      expect(raised?.message).toContain("NEXTAUTH_URL");
      expect(raised?.message).toContain("app.example.test");
      expect(raised?.matchedEnv).toBe("NEXTAUTH_URL");
    });

    it("says the endpoint was unset and which default applied", () => {
      expect(
        guard({
          endpoint: undefined,
          deployment: [{ env: "BASE_HOST", value: "https://app.langwatch.ai" }],
        }),
      ).toThrow(/LANGWATCH_ENDPOINT is unset, so the SDK default https:\/\/app\.langwatch\.ai/);
    });

    /** @scenario "The refusal names the variables and never the key" */
    it("never prints the key", () => {
      let raised: SelfIngestingObservabilityError | undefined;
      try {
        guard({ apiKey: "sk-lw-secret-value", endpoint: "https://app.example.test" })();
      } catch (error) {
        raised = error as SelfIngestingObservabilityError;
      }

      expect(raised).toBeDefined();
      expect(JSON.stringify({ message: raised?.message, ...raised })).not.toContain(
        "sk-lw-secret-value",
      );
    });
  });

  describe("given an address neither side can resolve", () => {
    it("accepts a deployment that stated no address at all", () => {
      expect(guard({ endpoint: "https://app.example.test", deployment: [] })).not.toThrow();
    });

    it("accepts a blank deployment address rather than matching everything", () => {
      expect(
        guard({
          endpoint: "https://app.example.test",
          deployment: [{ env: "BASE_HOST", value: "   " }],
        }),
      ).not.toThrow();
    });
  });
});
