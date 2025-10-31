import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LangWatchTraceExporter, type LangWatchTraceExporterOptions } from "../langwatch-trace-exporter";
import {
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_VERSION,
  LANGWATCH_SDK_RUNTIME,
  TRACES_PATH,
} from "../../../internal/constants.js";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const DEFAULT_ENDPOINT = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
const DEFAULT_URL = `${DEFAULT_ENDPOINT}${TRACES_PATH}`;

// Mock the OTLP exporter
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  const Ctor: any = vi.fn(function (this: any, config: any) {
    this.config = config;
    this.url = config.url;
    this.headers = config.headers;
    this.__lastExportedSpans = undefined;
  });
  Ctor.prototype.export = function (this: any, spans: any[], cb: any) {
    this.__lastExportedSpans = spans;
    if (typeof cb === "function") cb({});
  };
  return { OTLPTraceExporter: Ctor };
});

describe("LangWatchExporter", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleSpy: any;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Mock console.warn to test deprecation warnings
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

    afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Restore console.warn
    consoleSpy.mockRestore();

    // Clear mock calls
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create exporter with default values when no options provided", () => {
      const exporter = new LangWatchTraceExporter();

      expect(exporter).toBeInstanceOf(LangWatchTraceExporter);
      // Access the config through the mock
      expect((exporter as any).config).toBeDefined();
      expect((exporter as any).url).toBe(DEFAULT_URL);
    });

    it("should use provided API key in options", () => {
      const apiKey = "test-api-key";
      const exporter = new LangWatchTraceExporter({ apiKey });

      const headers = (exporter as any).headers;
      expect(headers).toMatchObject({
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
        authorization: `Bearer ${apiKey}`,
      });
    });

    it("should use provided endpoint in options", () => {
      const endpoint = "https://custom.langwatch.com";
      const exporter = new LangWatchTraceExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
    });

    it("should use both custom API key and endpoint", () => {
      const apiKey = "custom-key";
      const endpoint = "https://custom.langwatch.com";
      const exporter = new LangWatchTraceExporter({ apiKey, endpoint });

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });
  });

  describe("environment variable fallbacks", () => {
    it("should fallback to LANGWATCH_API_KEY environment variable", () => {
      const apiKey = "env-api-key";
      process.env.LANGWATCH_API_KEY = apiKey;

      const exporter = new LangWatchTraceExporter();

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });

    it("should fallback to LANGWATCH_ENDPOINT environment variable", () => {
      const endpoint = "https://env.langwatch.ai";
      process.env.LANGWATCH_ENDPOINT = endpoint;

      const exporter = new LangWatchTraceExporter();

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
    });

    it("should prioritize options over environment variables", () => {
      process.env.LANGWATCH_API_KEY = "env-key";
      process.env.LANGWATCH_ENDPOINT = "https://env.langwatch.ai";

      const optionsKey = "options-key";
      const optionsEndpoint = "https://options.langwatch.com";

      const exporter = new LangWatchTraceExporter({
        apiKey: optionsKey,
        endpoint: optionsEndpoint,
      });

      expect((exporter as any).url).toBe(`${optionsEndpoint}/api/otel/v1/traces`);
      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${optionsKey}`);
    });

    it("should use default endpoint when no endpoint provided", () => {
      delete process.env.LANGWATCH_ENDPOINT;

      const exporter = new LangWatchTraceExporter();

      expect((exporter as any).url).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    });

    it("should handle missing API key gracefully", () => {
      delete process.env.LANGWATCH_API_KEY;

      const exporter = new LangWatchTraceExporter();

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBeUndefined();
      expect(headers).not.toHaveProperty("authorization");
    });
  });

  describe("header configuration", () => {
    it("should include all required SDK headers", () => {
      const exporter = new LangWatchTraceExporter();

      const headers = (exporter as any).headers;
      expect(headers).toMatchObject({
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
      });
    });

    it("should include authorization header when API key is provided", () => {
      const apiKey = "test-key";
      const exporter = new LangWatchTraceExporter({ apiKey });

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });

    it("should not include authorization header when no API key is provided", () => {
      delete process.env.LANGWATCH_API_KEY;
      const exporter = new LangWatchTraceExporter();

      const headers = (exporter as any).headers;
      expect(headers).not.toHaveProperty("authorization");
    });
  });

  // deprecated options removed

  describe("URL construction", () => {
    it("should construct URL correctly with default endpoint", () => {
      const exporter = new LangWatchTraceExporter();

      expect((exporter as any).url).toBe(DEFAULT_URL);
    });

    it("should construct URL correctly with custom endpoint", () => {
      const endpoint = "https://custom.example.com";
      const exporter = new LangWatchTraceExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
    });

    it("should handle endpoint with trailing slash", () => {
      const endpoint = "https://custom.example.com/";
      const exporter = new LangWatchTraceExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}api/otel/v1/traces`);
    });

    it("should fail with endpoint is given without protocol", () => {
      const endpoint = "custom.example.com";

      expect(() => {
        new LangWatchTraceExporter({ endpoint });
      }).toThrow("Invalid URL");
    });

    it("should use TRACES_PATH constant for URL construction", () => {
      const endpoint = "https://test.com";
      const exporter = new LangWatchTraceExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}${TRACES_PATH}`);
    });
  });

  describe("inheritance from OTLPTraceExporter", () => {
    it("should extend OTLPTraceExporter", () => {
      const exporter = new LangWatchTraceExporter();

      // Since we're mocking OTLPTraceExporter, we check that the constructor was called
      expect(vi.mocked(OTLPTraceExporter)).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
            "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
            "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
            "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
          }),
          url: expect.stringContaining("/api/otel/v1/traces"),
        })
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty string API key", () => {
      const exporter = new LangWatchTraceExporter({ apiKey: "" });

      const headers = (exporter as any).headers;
      expect(headers).not.toHaveProperty("authorization");
    });

    it("should handle empty string endpoint", () => {
      expect(() => {
        new LangWatchTraceExporter({ endpoint: "" });
      }).toThrow(); // URL constructor should throw for empty string
    });

    it("should handle null values in options", () => {
      const exporter = new LangWatchTraceExporter({
        apiKey: null as any,
        endpoint: null as any,
      });

      // Should fallback to environment variables or defaults
      expect((exporter as any).url).toBe(DEFAULT_URL);
    });

    it("should handle complex endpoint URLs", () => {
      const endpoint = "https://subdomain.example.com:8080/path";
      const exporter = new LangWatchTraceExporter({ endpoint });

      // URL constructor behavior: new URL("/api/otel/v1/traces", "https://subdomain.example.com:8080/path")
      // results in "https://subdomain.example.com:8080/api/otel/v1/traces" (path gets replaced, not appended)
      expect((exporter as any).url).toBe("https://subdomain.example.com:8080/api/otel/v1/traces");
    });
  });

  describe("type safety", () => {
    it("should accept valid LangWatchExporterOptions", () => {
      const options: LangWatchTraceExporterOptions = {
        apiKey: "test-key",
        endpoint: "https://test.com",
        filters: [{ preset: "vercelAIOnly" }],
      };

      expect(() => {
        new LangWatchTraceExporter(options);
      }).not.toThrow();
    });

    it("should work without any options", () => {
      expect(() => {
        new LangWatchTraceExporter();
      }).not.toThrow();
    });

    it("should work with partial options", () => {
      expect(() => {
        new LangWatchTraceExporter({ apiKey: "test" });
      }).not.toThrow();

      expect(() => {
        new LangWatchTraceExporter({ endpoint: "https://test.com" });
      }).not.toThrow();
    });
  });

  describe("filters pipeline", () => {
    function makeSpans() {
      return [
        { name: "GET /users", instrumentationScope: { name: "http" }, attributes: { "http.method": "GET" }, resource: { attributes: { "service.name": "api" } } },
        { name: "chat.completion", instrumentationScope: { name: "ai" }, attributes: { "app.env": "prod" }, resource: { attributes: { region: "us" } } },
        { name: "custom op", instrumentationScope: { name: "custom" }, attributes: { foo: "bar" }, resource: { attributes: { "service.name": "worker" } } },
      ];
    }

    it("default excludes HTTP request spans", () => {
      const exporter = new LangWatchTraceExporter();
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const names = (exporter as any).__lastExportedSpans.map((s: any) => s.name);
      expect(names).toEqual(expect.arrayContaining(["chat.completion", "custom op"]));
      expect(names).not.toContain("GET /users");
    });

    it("accepts null filters to disable filtering", () => {
      const exporter = new LangWatchTraceExporter({ filters: null });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toHaveLength(3);
      expect(result.map((s: any) => s.name)).toEqual(expect.arrayContaining([
        "GET /users",
        "chat.completion",
        "custom op"
      ]));
    });

    it("accepts empty array to disable filtering", () => {
      const exporter = new LangWatchTraceExporter({ filters: [] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toHaveLength(3);
      expect(result.map((s: any) => s.name)).toEqual(expect.arrayContaining([
        "GET /users",
        "chat.completion",
        "custom op"
      ]));
    });

    it("preset vercelAIOnly keeps only AI spans", () => {
      const exporter = new LangWatchTraceExporter({ filters: [{ preset: "vercelAIOnly" }] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toEqual([
        expect.objectContaining({ instrumentationScope: expect.objectContaining({ name: "ai" }) }),
      ]);
    });

    it("preset excludeHttpRequests removes HTTP request spans", () => {
      const exporter = new LangWatchTraceExporter({ filters: [{ preset: "excludeHttpRequests" }] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const names = (exporter as any).__lastExportedSpans.map((s: any) => s.name);
      expect(names).not.toContain("GET /users");
      expect(names).toEqual(expect.arrayContaining(["chat.completion", "custom op"]));
    });

    it("pipeline include instrumentation ai then exclude http requests", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { instrumentationScopeName: [{ equals: "ai" }] } },
        { preset: "excludeHttpRequests" },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toHaveLength(1);
      expect(result[0].instrumentationScope.name).toBe("ai");
    });

    it("criteria by name startsWith only", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { name: [{ startsWith: "chat." }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("chat.completion");
    });

    it("include instrumentationScopeName equals (case-sensitive by default)", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { instrumentationScopeName: [{ equals: "ai" }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toHaveLength(1);
      expect(result[0].instrumentationScope.name).toBe("ai");
    });

    it("include name equals (case-sensitive by default)", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { name: [{ equals: "chat.completion" }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const names = (exporter as any).__lastExportedSpans.map((s: any) => s.name);
      expect(names).toEqual(["chat.completion"]);
    });

    it("include name equals with ignoreCase true", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { name: [{ equals: "CHAT.completion", ignoreCase: true }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const names = (exporter as any).__lastExportedSpans.map((s: any) => s.name);
      expect(names).toEqual(["chat.completion"]);
    });

    it("include name with OR semantics across array of Match", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { name: [{ startsWith: "chat." }, { equals: "custom op" }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const names = (exporter as any).__lastExportedSpans.map((s: any) => s.name);
      expect(names).toEqual(expect.arrayContaining(["chat.completion", "custom op"]));
      expect(names).not.toContain("GET /users");
    });

    it("include instrumentationScopeName with OR array", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { instrumentationScopeName: [{ equals: "ai" }, { equals: "custom" }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const scopes = (exporter as any).__lastExportedSpans.map((s: any) => s.instrumentationScope.name);
      expect(scopes).toEqual(expect.arrayContaining(["ai", "custom"]));
      expect(scopes).not.toContain("http");
    });

    it("include then exclude applies sequentially (AND pipeline)", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { include: { instrumentationScopeName: [{ equals: "ai" }] } },
        { exclude: { name: [{ equals: "chat.completion" }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      const result = (exporter as any).__lastExportedSpans;
      expect(result).toHaveLength(0);
    });

    it("exclude then include can restore only matching subset (results zero here)", () => {
      const exporter = new LangWatchTraceExporter({ filters: [
        { exclude: { name: [{ startsWith: "chat." }] } },
        { include: { instrumentationScopeName: [{ equals: "ai" }] } },
      ] });
      const spans = makeSpans();
      (exporter as any).export(spans, () => undefined);
      expect((exporter as any).__lastExportedSpans).toHaveLength(0);
    });
  });
});
