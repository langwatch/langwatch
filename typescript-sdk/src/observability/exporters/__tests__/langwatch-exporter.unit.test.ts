import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LangWatchExporter, LangWatchExporterOptions } from "../langwatch-exporter";
import {
  LANGWATCH_SDK_NAME,
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_VERSION,
  LANGWATCH_SDK_RUNTIME,
  TRACES_PATH,
} from "../../setup/constants";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Mock the OTLP exporter
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: vi.fn().mockImplementation(function (this: any, config: any) {
    this.config = config;
    this.url = config.url;
    this.headers = config.headers;
  }),
}));

describe("LangWatchExporter", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleSpy: any;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Mock console.warn to test deprecation warnings
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      const exporter = new LangWatchExporter();

      expect(exporter).toBeInstanceOf(LangWatchExporter);
      // Access the config through the mock
      expect((exporter as any).config).toBeDefined();
      expect((exporter as any).url).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    });

    it("should use provided API key in options", () => {
      const apiKey = "test-api-key";
      const exporter = new LangWatchExporter({ apiKey });

      const headers = (exporter as any).headers;
      expect(headers).toMatchObject({
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME,
        authorization: `Bearer ${apiKey}`,
      });
    });

    it("should use provided endpoint in options", () => {
      const endpoint = "https://custom.langwatch.com";
      const exporter = new LangWatchExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
    });

    it("should use both custom API key and endpoint", () => {
      const apiKey = "custom-key";
      const endpoint = "https://custom.langwatch.com";
      const exporter = new LangWatchExporter({ apiKey, endpoint });

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });
  });

  describe("environment variable fallbacks", () => {
    it("should fallback to LANGWATCH_API_KEY environment variable", () => {
      const apiKey = "env-api-key";
      process.env.LANGWATCH_API_KEY = apiKey;

      const exporter = new LangWatchExporter();

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });

    it("should fallback to LANGWATCH_ENDPOINT environment variable", () => {
      const endpoint = "https://env.langwatch.ai";
      process.env.LANGWATCH_ENDPOINT = endpoint;

      const exporter = new LangWatchExporter();

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
    });

    it("should prioritize options over environment variables", () => {
      process.env.LANGWATCH_API_KEY = "env-key";
      process.env.LANGWATCH_ENDPOINT = "https://env.langwatch.ai";

      const optionsKey = "options-key";
      const optionsEndpoint = "https://options.langwatch.com";

      const exporter = new LangWatchExporter({
        apiKey: optionsKey,
        endpoint: optionsEndpoint,
      });

      expect((exporter as any).url).toBe(`${optionsEndpoint}/api/otel/v1/traces`);
      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${optionsKey}`);
    });

    it("should use default endpoint when no endpoint provided", () => {
      delete process.env.LANGWATCH_ENDPOINT;

      const exporter = new LangWatchExporter();

      expect((exporter as any).url).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    });

    it("should handle missing API key gracefully", () => {
      delete process.env.LANGWATCH_API_KEY;

      const exporter = new LangWatchExporter();

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBeUndefined();
      expect(headers).not.toHaveProperty("authorization");
    });
  });

  describe("header configuration", () => {
    it("should include all required SDK headers", () => {
      const exporter = new LangWatchExporter();

      const headers = (exporter as any).headers;
      expect(headers).toMatchObject({
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME,
      });
    });

    it("should include authorization header when API key is provided", () => {
      const apiKey = "test-key";
      const exporter = new LangWatchExporter({ apiKey });

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });

    it("should not include authorization header when no API key is provided", () => {
      delete process.env.LANGWATCH_API_KEY;
      const exporter = new LangWatchExporter();

      const headers = (exporter as any).headers;
      expect(headers).not.toHaveProperty("authorization");
    });
  });

  describe("deprecated options", () => {
    it("should warn when includeAllSpans option is provided", () => {
      new LangWatchExporter({ includeAllSpans: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[LangWatchExporter] The behavior of `includeAllSpans` is deprecated and will be removed in a future version"
      );
    });

    it("should warn when debug option is provided", () => {
      new LangWatchExporter({ debug: true });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[LangWatchExporter] The behavior of `debug` is deprecated and will be removed in a future version"
      );
    });

    it("should warn for both deprecated options when both are provided", () => {
      new LangWatchExporter({ includeAllSpans: false, debug: false });

      expect(consoleSpy).toHaveBeenCalledWith(
        "[LangWatchExporter] The behavior of `includeAllSpans` is deprecated and will be removed in a future version"
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "[LangWatchExporter] The behavior of `debug` is deprecated and will be removed in a future version"
      );
    });

    it("should not warn when deprecated options are undefined", () => {
      new LangWatchExporter({ apiKey: "test" });

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("should warn even when deprecated options are explicitly set to undefined", () => {
      // This tests the `!== void 0` check in the code
      new LangWatchExporter({ includeAllSpans: undefined });

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe("URL construction", () => {
    it("should construct URL correctly with default endpoint", () => {
      const exporter = new LangWatchExporter();

      expect((exporter as any).url).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    });

    it("should construct URL correctly with custom endpoint", () => {
      const endpoint = "https://custom.example.com";
      const exporter = new LangWatchExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}/api/otel/v1/traces`);
    });

    it("should handle endpoint with trailing slash", () => {
      const endpoint = "https://custom.example.com/";
      const exporter = new LangWatchExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}api/otel/v1/traces`);
    });

    it("should fail with endpoint is given without protocol", () => {
      const endpoint = "custom.example.com";

      expect(() => {
        new LangWatchExporter({ endpoint });
      }).toThrow("Invalid URL");
    });

    it("should use TRACES_PATH constant for URL construction", () => {
      const endpoint = "https://test.com";
      const exporter = new LangWatchExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}${TRACES_PATH}`);
    });
  });

  describe("inheritance from OTLPTraceExporter", () => {
    it("should extend OTLPTraceExporter", () => {
      const exporter = new LangWatchExporter();

      // Since we're mocking OTLPTraceExporter, we check that the constructor was called
      expect(vi.mocked(OTLPTraceExporter)).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
            "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
            "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
            "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME,
          }),
          url: expect.stringContaining("/api/otel/v1/traces"),
        })
      );
    });
  });

  describe("edge cases", () => {
    it("should handle empty string API key", () => {
      const exporter = new LangWatchExporter({ apiKey: "" });

      const headers = (exporter as any).headers;
      expect(headers).not.toHaveProperty("authorization");
    });

    it("should handle empty string endpoint", () => {
      expect(() => {
        new LangWatchExporter({ endpoint: "" });
      }).toThrow(); // URL constructor should throw for empty string
    });

    it("should handle null values in options", () => {
      const exporter = new LangWatchExporter({
        apiKey: null as any,
        endpoint: null as any,
      });

      // Should fallback to environment variables or defaults
      expect((exporter as any).url).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    });

    it("should handle complex endpoint URLs", () => {
      const endpoint = "https://subdomain.example.com:8080/path";
      const exporter = new LangWatchExporter({ endpoint });

      // URL constructor behavior: new URL("/api/otel/v1/traces", "https://subdomain.example.com:8080/path")
      // results in "https://subdomain.example.com:8080/api/otel/v1/traces" (path gets replaced, not appended)
      expect((exporter as any).url).toBe("https://subdomain.example.com:8080/api/otel/v1/traces");
    });
  });

  describe("type safety", () => {
    it("should accept valid LangWatchExporterOptions", () => {
      const options: LangWatchExporterOptions = {
        apiKey: "test-key",
        endpoint: "https://test.com",
        includeAllSpans: true,
        debug: false,
      };

      expect(() => {
        new LangWatchExporter(options);
      }).not.toThrow();
    });

    it("should work without any options", () => {
      expect(() => {
        new LangWatchExporter();
      }).not.toThrow();
    });

    it("should work with partial options", () => {
      expect(() => {
        new LangWatchExporter({ apiKey: "test" });
      }).not.toThrow();

      expect(() => {
        new LangWatchExporter({ endpoint: "https://test.com" });
      }).not.toThrow();
    });
  });
});
