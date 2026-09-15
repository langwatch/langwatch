import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LangWatchLogsExporter,
  type LangWatchLogsExporterOptions,
} from "../langwatch-logs-exporter";
import {
  LANGWATCH_SDK_NAME_OBSERVABILITY as LANGWATCH_SDK_NAME,
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_VERSION,
  LANGWATCH_SDK_RUNTIME,
  LOGS_PATH,
} from "../../../internal/constants";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";

const DEFAULT_ENDPOINT = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
const DEFAULT_URL = `${DEFAULT_ENDPOINT}${LOGS_PATH}`;

// Mock the OTLP exporter
vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: vi.fn().mockImplementation(function (this: any, config: any) {
    this.config = config;
    this.url = config.url;
    this.headers = config.headers;
  }),
}));

describe("LangWatchLogsExporter", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Clear mock calls
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("creates exporter with default values when no options provided", () => {
      const exporter = new LangWatchLogsExporter();

      expect(exporter).toBeInstanceOf(LangWatchLogsExporter);
      // Access the config through the mock
      expect((exporter as any).config).toBeDefined();
      expect((exporter as any).url).toBe(DEFAULT_URL);
    });

    it("uses provided API key in options", () => {
      const apiKey = "test-api-key";
      const exporter = new LangWatchLogsExporter({ apiKey });

      const headers = (exporter as any).headers;
      expect(headers).toMatchObject({
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
        authorization: `Bearer ${apiKey}`,
      });
    });

    it("uses provided endpoint in options", () => {
      const endpoint = "https://custom.langwatch.com";
      const exporter = new LangWatchLogsExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}${LOGS_PATH}`);
    });

    it("uses both custom API key and endpoint", () => {
      const apiKey = "custom-key";
      const endpoint = "https://custom.langwatch.com";
      const exporter = new LangWatchLogsExporter({ apiKey, endpoint });

      expect((exporter as any).url).toBe(`${endpoint}${LOGS_PATH}`);
      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });
  });

  describe("environment variable fallbacks", () => {
    it("fallbacks to LANGWATCH_API_KEY environment variable", () => {
      const apiKey = "env-api-key";
      process.env.LANGWATCH_API_KEY = apiKey;

      const exporter = new LangWatchLogsExporter();

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });

    it("fallbacks to LANGWATCH_ENDPOINT environment variable", () => {
      const endpoint = "https://env.langwatch.ai";
      process.env.LANGWATCH_ENDPOINT = endpoint;

      const exporter = new LangWatchLogsExporter();

      expect((exporter as any).url).toBe(`${endpoint}${LOGS_PATH}`);
    });

    it("prioritizes options over environment variables", () => {
      process.env.LANGWATCH_API_KEY = "env-key";
      process.env.LANGWATCH_ENDPOINT = "https://env.langwatch.ai";

      const optionsKey = "options-key";
      const optionsEndpoint = "https://options.langwatch.com";

      const exporter = new LangWatchLogsExporter({
        apiKey: optionsKey,
        endpoint: optionsEndpoint,
      });

      expect((exporter as any).url).toBe(`${optionsEndpoint}${LOGS_PATH}`);
      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${optionsKey}`);
    });

    it("uses default endpoint when no endpoint provided", () => {
      delete process.env.LANGWATCH_ENDPOINT;

      const exporter = new LangWatchLogsExporter();

      expect((exporter as any).url).toBe("https://app.langwatch.ai/api/otel/v1/logs");
    });

    it("handles missing API key gracefully", () => {
      delete process.env.LANGWATCH_API_KEY;

      const exporter = new LangWatchLogsExporter();

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBeUndefined();
      expect(headers).not.toHaveProperty("authorization");
    });
  });

  describe("header configuration", () => {
    it("includes all required SDK headers", () => {
      const exporter = new LangWatchLogsExporter();

      const headers = (exporter as any).headers;
      expect(headers).toMatchObject({
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
      });
    });

    it("includes authorization header when API key is provided", () => {
      const apiKey = "test-key";
      const exporter = new LangWatchLogsExporter({ apiKey });

      const headers = (exporter as any).headers;
      expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    });

    it("does not include authorization header when no API key is provided", () => {
      delete process.env.LANGWATCH_API_KEY;
      const exporter = new LangWatchLogsExporter();

      const headers = (exporter as any).headers;
      expect(headers).not.toHaveProperty("authorization");
    });
  });

  describe("URL construction", () => {
    it("constructs URL correctly with default endpoint", () => {
      const exporter = new LangWatchLogsExporter();

      expect((exporter as any).url).toBe(DEFAULT_URL);
    });

    it("constructs URL correctly with custom endpoint", () => {
      const endpoint = "https://custom.example.com";
      const exporter = new LangWatchLogsExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}${LOGS_PATH}`);
    });

    it("handles endpoint with trailing slash", () => {
      const endpoint = "https://custom.example.com/";
      const exporter = new LangWatchLogsExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}api/otel/v1/logs`);
    });

    it("fails when endpoint is given without protocol", () => {
      const endpoint = "custom.example.com";

      expect(() => {
        new LangWatchLogsExporter({ endpoint });
      }).toThrow("Invalid URL");
    });

    it("uses LOGS_PATH constant for URL construction", () => {
      const endpoint = "https://test.com";
      const exporter = new LangWatchLogsExporter({ endpoint });

      expect((exporter as any).url).toBe(`${endpoint}${LOGS_PATH}`);
    });
  });

  describe("inheritance from OTLPLogExporter", () => {
    it("extends OTLPLogExporter", () => {
      new LangWatchLogsExporter();

      // Since we're mocking OTLPLogExporter, we check that the constructor was called
      expect(vi.mocked(OTLPLogExporter)).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-langwatch-sdk-name": LANGWATCH_SDK_NAME,
            "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
            "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
            "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
          }),
          url: expect.stringContaining(LOGS_PATH),
        }),
      );
    });
  });

  describe("edge cases", () => {
    it("handles empty string API key", () => {
      const exporter = new LangWatchLogsExporter({ apiKey: "" });

      const headers = (exporter as any).headers;
      expect(headers).not.toHaveProperty("authorization");
    });

    it("handles empty string endpoint", () => {
      expect(() => {
        new LangWatchLogsExporter({ endpoint: "" });
      }).toThrow(); // URL constructor should throw for empty string
    });

    it("handles null values in options", () => {
      const exporter = new LangWatchLogsExporter({
        apiKey: null as any,
        endpoint: null as any,
      });

      // Should fallback to environment variables or defaults
      expect((exporter as any).url).toBe(DEFAULT_URL);
    });

    it("handles complex endpoint URLs", () => {
      const endpoint = "https://subdomain.example.com:8080/path";
      const exporter = new LangWatchLogsExporter({ endpoint });

      // URL constructor behavior: new URL("/api/otel/v1/logs", "https://subdomain.example.com:8080/path")
      // results in "https://subdomain.example.com:8080/api/otel/v1/logs" (path gets replaced, not appended)
      expect((exporter as any).url).toBe(`https://subdomain.example.com:8080${LOGS_PATH}`);
    });
  });

  describe("type safety", () => {
    it("accepts valid LangWatchLogsExporterOptions", () => {
      const options: LangWatchLogsExporterOptions = {
        apiKey: "test-key",
        endpoint: "https://test.com",
      };

      expect(() => {
        new LangWatchLogsExporter(options);
      }).not.toThrow();
    });

    it("works without any options", () => {
      expect(() => {
        new LangWatchLogsExporter();
      }).not.toThrow();
    });

    it("works with partial options", () => {
      expect(() => {
        new LangWatchLogsExporter({ apiKey: "test" });
      }).not.toThrow();

      expect(() => {
        new LangWatchLogsExporter({ endpoint: "https://test.com" });
      }).not.toThrow();
    });
  });
});
