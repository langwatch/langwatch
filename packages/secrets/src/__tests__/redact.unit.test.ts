import { describe, expect, it } from "vitest";
import { REDACTED, redactForLog, secretLogRedactPaths } from "../redact.ts";

describe("given a secret key and its value", () => {
  describe("when the value is prepared for a log line", () => {
    /** @scenario "A secret becomes the marker" */
    it("reads as the redaction marker and carries none of the value", () => {
      const redacted = redactForLog({ key: "OPENAI_API_KEY", value: "sk-live-abc123" });

      expect(redacted).toBe(REDACTED);
      expect(String(redacted)).not.toContain("abc123");
    });
  });
});

describe("given a database URL with a username, a password and a query string", () => {
  describe("when the value is prepared for a log line", () => {
    /** @scenario "A composite URL keeps its shape and loses its credential" */
    it("keeps the scheme, host, port and path and drops the userinfo and query", () => {
      const redacted = redactForLog({
        key: "DATABASE_URL",
        value: "postgresql://app:hunter2@db.internal:5432/langwatch?sslmode=require",
      });

      expect(redacted).toBe("postgresql://db.internal:5432/langwatch");
      expect(String(redacted)).not.toContain("hunter2");
      expect(String(redacted)).not.toContain("sslmode");
    });
  });
});

describe("given a composite key whose value cannot be parsed as a URL", () => {
  describe("when the value is prepared for a log line", () => {
    /** @scenario "A composite value that is not a URL is redacted whole" */
    it("reads as the redaction marker", () => {
      expect(
        redactForLog({ key: "OTEL_EXPORTER_OTLP_HEADERS", value: "authorization=Bearer tok" }),
      ).toBe(REDACTED);
    });
  });
});

describe("given a key the registry does not name", () => {
  describe("when the value is prepared for a log line", () => {
    /** @scenario "A configuration value passes through" */
    it("leaves it unchanged", () => {
      expect(redactForLog({ key: "BASE_HOST", value: "http://localhost:5560" })).toBe(
        "http://localhost:5560",
      );
      expect(redactForLog({ key: "S3_BUCKET_NAME", value: "langwatch-dev" })).toBe("langwatch-dev");
    });
  });
});

describe("given the pino redact paths", () => {
  describe("when they are built", () => {
    it("names each secret key at the top level and one level down", () => {
      const paths = secretLogRedactPaths();

      expect(paths).toContain("OPENAI_API_KEY");
      expect(paths).toContain("*.OPENAI_API_KEY");
      expect(paths).not.toContain("BASE_HOST");
    });
  });
});
