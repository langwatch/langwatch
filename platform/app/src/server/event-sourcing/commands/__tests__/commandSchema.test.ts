import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Stable singleton logger so a test can spy the SAME `error` fn the module
// captured at import time (`const logger = createLogger(...)` runs once).
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => loggerMock,
}));

import { COMMAND_TYPES } from "../../domain/commandType";
import { defineCommandSchema } from "../commandSchema";

/**
 * `defineCommandSchema` delegates parsing to the Zod schema it is handed, so
 * the only behaviour of ours worth pinning is what it does around that call:
 * logging the failure with enough context to identify the offending command.
 */
describe("defineCommandSchema", () => {
  const payloadSchema = z.object({
    id: z.string(),
    profile: z.object({ name: z.string() }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a payload that fails validation", () => {
    describe("when validate is called", () => {
      it("logs the command type and every Zod issue with a dotted path", () => {
        const schema = defineCommandSchema(COMMAND_TYPES[0], payloadSchema);

        schema.validate({ id: 42, profile: {} });

        expect(loggerMock.error).toHaveBeenCalledTimes(1);
        expect(loggerMock.error).toHaveBeenCalledWith(
          {
            commandType: COMMAND_TYPES[0],
            zodIssues: expect.arrayContaining([
              expect.objectContaining({
                path: "id",
                code: "invalid_type",
                message: expect.any(String),
              }),
              expect.objectContaining({
                path: "profile.name",
                code: "invalid_type",
                message: expect.any(String),
              }),
            ]),
          },
          "Command payload validation failed",
        );

        // Every issue is forwarded, not just the first one.
        const logContext = loggerMock.error.mock.calls[0]?.[0] as {
          zodIssues: unknown[];
        };
        expect(logContext.zodIssues).toHaveLength(2);
      });

      it("returns the failed parse result instead of throwing", () => {
        const schema = defineCommandSchema(COMMAND_TYPES[0], payloadSchema);

        const result = schema.validate({ id: 42, profile: {} });

        expect(result.success).toBe(false);
      });
    });
  });

  describe("given a payload that passes validation", () => {
    describe("when validate is called", () => {
      it("returns the parsed data without logging an error", () => {
        const schema = defineCommandSchema(COMMAND_TYPES[0], payloadSchema);
        const payload = { id: "command-1", profile: { name: "Jane" } };

        const result = schema.validate(payload);

        if (!result.success) {
          throw new Error("expected the payload to pass validation");
        }
        expect(result.data).toEqual(payload);
        expect(loggerMock.error).not.toHaveBeenCalled();
      });
    });
  });
});
