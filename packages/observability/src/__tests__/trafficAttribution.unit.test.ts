import { describe, expect, it } from "vitest";
import {
  classifyClient,
  endpointClassOf,
} from "../request/trafficAttribution";

const headersOf =
  (headers: Record<string, string>) =>
  (name: string): string | undefined =>
    headers[name];

describe("classifyClient", () => {
  describe("when the request carries the LangWatch SDK identity headers", () => {
    /** @scenario A request from a LangWatch SDK names the SDK on the log line */
    it("attributes the request to the SDK with name, language and version", () => {
      expect(
        classifyClient(
          headersOf({
            "user-agent": "langwatch-sdk-node/3.1.0",
            "x-langwatch-sdk-name": "langwatch-observability-sdk",
            "x-langwatch-sdk-language": "typescript",
            "x-langwatch-sdk-version": "3.1.0",
          }),
        ),
      ).toEqual({
        clientSource: "sdk",
        clientSdkName: "langwatch-observability-sdk",
        clientSdkLanguage: "typescript",
        clientSdkVersion: "3.1.0",
      });
    });

    /** @scenario A request from a LangWatch SDK names the SDK on the log line */
    it("recognises the Go SDK from its user agent alone", () => {
      expect(
        classifyClient(headersOf({ "user-agent": "langwatch-sdk-go/0.4.2" })),
      ).toEqual({
        clientSource: "sdk",
        clientSdkName: "langwatch-sdk-go",
        clientSdkLanguage: "go",
        clientSdkVersion: "0.4.2",
      });
    });
  });

  describe("when the request declares the CLI surface", () => {
    /** @scenario A request from the CLI is attributed to the CLI */
    it("attributes the request to the CLI even with SDK headers present", () => {
      expect(
        classifyClient(
          headersOf({
            "x-langwatch-surface": "cli",
            "x-langwatch-sdk-name": "langwatch-observability-sdk",
            "x-langwatch-sdk-version": "3.1.0",
          }),
        ),
      ).toMatchObject({ clientSource: "cli", clientSdkVersion: "3.1.0" });
    });
  });

  describe("when the request comes from the LangWatch MCP server", () => {
    /** @scenario A request from the LangWatch MCP server is attributed to MCP */
    it("attributes the request to MCP by its identity header", () => {
      expect(
        classifyClient(
          headersOf({
            "x-langwatch-sdk-name": "langwatch-mcp",
            "x-langwatch-sdk-version": "1.4.0",
          }),
        ),
      ).toMatchObject({ clientSource: "mcp", clientSdkVersion: "1.4.0" });
    });

    /** @scenario A request from the LangWatch MCP server is attributed to MCP */
    it("attributes the request to MCP by its user agent", () => {
      expect(
        classifyClient(headersOf({ "user-agent": "langwatch-mcp/1.4.0" })),
      ).toMatchObject({ clientSource: "mcp", clientSdkVersion: "1.4.0" });
    });
  });

  describe("when the user agent is curl", () => {
    /** @scenario A curl request is attributed to curl */
    it("attributes the request to curl", () => {
      expect(classifyClient(headersOf({ "user-agent": "curl/8.6.0" }))).toEqual(
        { clientSource: "curl" },
      );
    });
  });

  describe("when the user agent is a browser", () => {
    /** @scenario A browser request is attributed to the browser */
    it("attributes the request to the browser", () => {
      expect(
        classifyClient(
          headersOf({
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          }),
        ),
      ).toEqual({ clientSource: "browser" });
    });
  });

  describe("when an OpenTelemetry exporter that is not ours sends telemetry", () => {
    /** @scenario A generic OpenTelemetry exporter is attributed as one */
    it("attributes the request to an OpenTelemetry exporter", () => {
      expect(
        classifyClient(
          headersOf({ "user-agent": "OTel-OTLP-Exporter-Python/1.27.0" }),
        ),
      ).toEqual({ clientSource: "otel-exporter" });
    });
  });

  describe("when only the bare SDK version header arrives", () => {
    /** @scenario A legacy Python SDK export still counts as an SDK */
    it("attributes the request to the SDK, with language from the user agent", () => {
      expect(
        classifyClient(
          headersOf({
            "user-agent": "OTel-OTLP-Exporter-Python/1.27.0",
            "x-langwatch-sdk-version": "0.2.9",
          }),
        ),
      ).toEqual({
        clientSource: "sdk",
        clientSdkLanguage: "python",
        clientSdkVersion: "0.2.9",
      });
    });
  });

  describe("when nothing identifies the client", () => {
    /** @scenario An unidentified client is classified as unknown */
    it("classifies the client as unknown without failing", () => {
      expect(classifyClient(headersOf({}))).toEqual({
        clientSource: "unknown",
      });
    });

    /** @scenario An unidentified client is classified as unknown */
    it("classifies the client as unknown when reading headers throws", () => {
      expect(
        classifyClient(() => {
          throw new Error("no headers here");
        }),
      ).toEqual({ clientSource: "unknown" });
    });
  });

  describe("when a generic HTTP library calls the API", () => {
    it("attributes the request to an HTTP client", () => {
      expect(
        classifyClient(headersOf({ "user-agent": "python-requests/2.32.0" })),
      ).toEqual({ clientSource: "http-client" });
    });
  });

  describe("when the request comes from the coding-agent tracking client", () => {
    /** @scenario A request from the coding-agent tracking client is attributed to the SDK */
    it("attributes a TypeScript agent-tracking request to the SDK", () => {
      expect(
        classifyClient(
          headersOf({ "user-agent": "langwatch-typescript/1.2.3" }),
        ),
      ).toEqual({
        clientSource: "sdk",
        clientSdkName: "langwatch-typescript",
        clientSdkLanguage: "typescript",
        clientSdkVersion: "1.2.3",
      });
    });

    /** @scenario A request from the coding-agent tracking client is attributed to the SDK */
    it("attributes a Python agent-tracking request to the SDK", () => {
      expect(
        classifyClient(headersOf({ "user-agent": "langwatch-python/0.9.1" })),
      ).toEqual({
        clientSource: "sdk",
        clientSdkName: "langwatch-python",
        clientSdkLanguage: "python",
        clientSdkVersion: "0.9.1",
      });
    });
  });

  describe("when an internal LangWatch service calls the API", () => {
    /** @scenario A request from an internal LangWatch service is attributed as internal */
    it("attributes the AI gateway to the internal client source", () => {
      expect(
        classifyClient(
          headersOf({ "user-agent": "langwatch-aigateway/2.0.1" }),
        ),
      ).toEqual({
        clientSource: "internal",
        clientSdkName: "langwatch-aigateway",
        clientSdkVersion: "2.0.1",
      });
    });
  });

  describe("when the user agent only looks like a known name", () => {
    /** @scenario A user agent that only looks like a known name does not match */
    it("classifies a prototype-property-shaped user agent as unknown", () => {
      expect(
        classifyClient(headersOf({ "user-agent": "constructor/1.0" })),
      ).toEqual({ clientSource: "unknown" });
    });
  });
});

describe("endpointClassOf", () => {
  describe("when requests arrive on telemetry ingestion paths", () => {
    /** @scenario Telemetry ingestion paths are classed as ingestion surfaces */
    it("classes collector, OTLP and browser telemetry paths distinctly", () => {
      expect(endpointClassOf("/api/collector")).toBe("collector");
      expect(endpointClassOf("/api/otel/v1/traces")).toBe("otlp");
      expect(endpointClassOf("/api/otel/v1/logs")).toBe("otlp");
      expect(endpointClassOf("/api/rum/v1/traces")).toBe("rum");
      expect(endpointClassOf("/api/ingest/some-source")).toBe("ingest");
    });

    /** @scenario Telemetry ingestion paths are classed as ingestion surfaces */
    it("classes the root-level OTLP aliases the same as the canonical paths", () => {
      expect(endpointClassOf("/v1/traces")).toBe("otlp");
      expect(endpointClassOf("/v1/logs")).toBe("otlp");
      expect(endpointClassOf("/v1/metrics")).toBe("otlp");
    });
  });

  describe("when the dashboard makes its own calls", () => {
    /** @scenario The dashboard's own calls are classed as dashboard traffic */
    it("classes tRPC paths as dashboard traffic", () => {
      expect(endpointClassOf("/api/trpc/organization.getAll")).toBe(
        "dashboard",
      );
      expect(
        endpointClassOf("/api/trpc/organization.getAll,project.getAll"),
      ).toBe("dashboard");
    });
  });

  describe("when requests arrive on surfaces with their own class", () => {
    it("classes auth, Langy, gateway and MCP paths distinctly", () => {
      expect(endpointClassOf("/api/auth/session")).toBe("auth");
      expect(endpointClassOf("/api/langy/conversations")).toBe("langy");
      expect(endpointClassOf("/api/gateway/v1/chat/completions")).toBe(
        "gateway",
      );
      expect(endpointClassOf("/api/internal/gateway/keys")).toBe("gateway");
      expect(endpointClassOf("/mcp")).toBe("mcp");
      expect(endpointClassOf("/mcp/health")).toBe("mcp");
      expect(endpointClassOf("/oauth/token")).toBe("mcp");
      expect(
        endpointClassOf("/.well-known/oauth-authorization-server/mcp"),
      ).toBe("mcp");
    });
  });

  describe("when an API path is claimed by no other surface", () => {
    /** @scenario Remaining API paths are classed as the public REST API */
    it("classes it as the public REST API", () => {
      expect(endpointClassOf("/api/traces/trace_123")).toBe("api");
      expect(endpointClassOf("/api/prompts")).toBe("api");
      expect(endpointClassOf("/api/dataset/slug/entries")).toBe("api");
    });

    it("classes non-API paths as other", () => {
      expect(endpointClassOf("/settings/members")).toBe("other");
      expect(endpointClassOf("/")).toBe("other");
    });
  });
});
