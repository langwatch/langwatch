import { describe, it, expect } from "vitest";
import {
  classifyClickHouseError,
  isTransientClickHouseError,
} from "../../clickhouse/error-classification";

describe("classifyClickHouseError()", () => {
  describe("when error contains MEMORY_LIMIT_EXCEEDED", () => {
    it("returns oom", () => {
      expect(classifyClickHouseError(new Error("MEMORY_LIMIT_EXCEEDED"))).toBe(
        "oom"
      );
    });
  });

  describe("when error message matches timeout", () => {
    it("returns timeout for Request Timeout", () => {
      expect(classifyClickHouseError(new Error("Request Timeout"))).toBe(
        "timeout"
      );
    });

    it("returns timeout for ETIMEDOUT code", () => {
      const err = new Error("timed out");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      expect(classifyClickHouseError(err)).toBe("timeout");
    });
  });

  describe("when error has a network code", () => {
    it("returns network for ECONNRESET", () => {
      const err = new Error("connection reset");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(classifyClickHouseError(err)).toBe("network");
    });

    it("returns network for ECONNREFUSED", () => {
      const err = new Error("connection refused");
      (err as NodeJS.ErrnoException).code = "ECONNREFUSED";
      expect(classifyClickHouseError(err)).toBe("network");
    });

    it("returns network for EPIPE", () => {
      const err = new Error("broken pipe");
      (err as NodeJS.ErrnoException).code = "EPIPE";
      expect(classifyClickHouseError(err)).toBe("network");
    });

    it("returns network for ENOTFOUND", () => {
      const err = new Error("not found");
      (err as NodeJS.ErrnoException).code = "ENOTFOUND";
      expect(classifyClickHouseError(err)).toBe("network");
    });
  });

  describe("when error has HTTP 429 status", () => {
    it("returns rate_limit", () => {
      const err = new Error("Too Many Requests") as Error & {
        statusCode: number;
      };
      err.statusCode = 429;
      expect(classifyClickHouseError(err)).toBe("rate_limit");
    });
  });

  describe("when error has HTTP 502 status", () => {
    it("returns unavailable", () => {
      const err = new Error("Bad Gateway") as Error & {
        statusCode: number;
      };
      err.statusCode = 502;
      expect(classifyClickHouseError(err)).toBe("unavailable");
    });
  });

  describe("when error has HTTP 503 status", () => {
    it("returns unavailable", () => {
      const err = new Error("Service Unavailable") as Error & {
        statusCode: number;
      };
      err.statusCode = 503;
      expect(classifyClickHouseError(err)).toBe("unavailable");
    });
  });

  describe("when error contains SYNTAX_ERROR", () => {
    it("returns syntax", () => {
      expect(classifyClickHouseError(new Error("SYNTAX_ERROR near ..."))).toBe(
        "syntax"
      );
    });
  });

  describe("when error contains Unknown column", () => {
    it("returns syntax", () => {
      expect(
        classifyClickHouseError(new Error("Unknown column 'foo'"))
      ).toBe("syntax");
    });
  });

  describe("when error is not recognized", () => {
    it("returns unknown for generic errors", () => {
      expect(classifyClickHouseError(new Error("something else"))).toBe(
        "unknown"
      );
    });

    it("returns unknown for non-Error values", () => {
      expect(classifyClickHouseError("string error")).toBe("unknown");
    });
  });
});

describe("isTransientClickHouseError()", () => {
  describe("when error contains MEMORY_LIMIT_EXCEEDED", () => {
    it("returns true", () => {
      expect(
        isTransientClickHouseError(new Error("MEMORY_LIMIT_EXCEEDED"))
      ).toBe(true);
    });
  });

  describe("when error has a network code", () => {
    it("returns true for ECONNRESET", () => {
      const err = new Error("connection reset");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(isTransientClickHouseError(err)).toBe(true);
    });

    it("returns true for ETIMEDOUT", () => {
      const err = new Error("timed out");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error message contains timeout", () => {
    it("returns true", () => {
      expect(
        isTransientClickHouseError(new Error("Request Timeout"))
      ).toBe(true);
    });
  });

  describe("when error has HTTP 502 status", () => {
    it("returns true", () => {
      const err = new Error("Bad Gateway") as Error & {
        statusCode: number;
      };
      err.statusCode = 502;
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error has HTTP 503 status", () => {
    it("returns true", () => {
      const err = new Error("Service Unavailable") as Error & {
        statusCode: number;
      };
      err.statusCode = 503;
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error has HTTP 429 status", () => {
    it("returns true", () => {
      const err = new Error("Too Many Requests") as Error & {
        statusCode: number;
      };
      err.statusCode = 429;
      expect(isTransientClickHouseError(err)).toBe(true);
    });
  });

  describe("when error is non-transient", () => {
    it("returns false for schema errors", () => {
      expect(
        isTransientClickHouseError(new Error("Table foo doesn't exist"))
      ).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isTransientClickHouseError("string error")).toBe(false);
    });
  });
});
