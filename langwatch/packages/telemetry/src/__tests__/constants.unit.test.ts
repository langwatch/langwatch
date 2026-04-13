import { describe, it, expect } from "vitest";
import {
  OTEL_ATTR,
  TRACER_NAMES,
  INVALID_TRACE_ID,
  DEFAULT_SERVICE_NAME,
} from "../constants";

describe("constants", () => {
  describe("OTEL_ATTR", () => {
    it("has business context attribute keys", () => {
      expect(OTEL_ATTR.ORGANIZATION_ID).toBe("organization.id");
      expect(OTEL_ATTR.TENANT_ID).toBe("tenant.id");
      expect(OTEL_ATTR.USER_ID).toBe("user.id");
      expect(OTEL_ATTR.PROJECT_ID).toBe("langwatch.project.id");
    });

    it("has observed trace/span attributes", () => {
      expect(OTEL_ATTR.OBSERVED_TRACE_ID).toBe("observed.trace.id");
      expect(OTEL_ATTR.OBSERVED_SPAN_ID).toBe("observed.span.id");
      expect(OTEL_ATTR.OBSERVED_PARENT_SPAN_ID).toBe("observed.parent_span.id");
      expect(OTEL_ATTR.OBSERVED_TIMESTAMP).toBe("observed.timestamp");
    });

    it("has span metadata attributes", () => {
      expect(OTEL_ATTR.SERVICE_NAME).toBe("service.name");
      expect(OTEL_ATTR.SPAN_KIND).toBe("span.kind");
    });
  });

  describe("TRACER_NAMES", () => {
    it("has all tracer names", () => {
      expect(TRACER_NAMES.NEXT_APP).toBe("langwatch:next:app");
      expect(TRACER_NAMES.NEXT_PAGES).toBe("langwatch:next:pages");
      expect(TRACER_NAMES.HONO).toBe("langwatch:api:hono");
      expect(TRACER_NAMES.COLLECTOR).toBe("langwatch:collector");
      expect(TRACER_NAMES.TRPC).toBe("langwatch:trpc");
    });
  });

  describe("INVALID_TRACE_ID", () => {
    it("is all zeros (32 chars)", () => {
      expect(INVALID_TRACE_ID).toBe("00000000000000000000000000000000");
      expect(INVALID_TRACE_ID).toHaveLength(32);
    });
  });

  describe("DEFAULT_SERVICE_NAME", () => {
    it("is langwatch-backend", () => {
      expect(DEFAULT_SERVICE_NAME).toBe("langwatch-backend");
    });
  });
});
