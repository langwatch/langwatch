import { describe, expect, it } from "vitest";
import { MAX_VALIDATION_ISSUES, validationMeta } from "../validation/validationMeta";

/**
 * The issues are hand-built rather than produced by zod on purpose: this
 * package does not depend on zod, and the contract under test is the duck-typed
 * shape, not one zod version's rendering of it. Each fixture mirrors a real
 * `ZodIssue` for the code it names.
 */

describe("validationMeta", () => {
  describe("given a value that is not a validation error", () => {
    it("returns undefined for a plain error", () => {
      expect(validationMeta(new Error("boom"))).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(validationMeta(null)).toBeUndefined();
    });

    it("returns undefined for an object without issues", () => {
      expect(validationMeta({ message: "nope" })).toBeUndefined();
    });
  });

  describe("when a field has the wrong type", () => {
    const error = {
      issues: [
        {
          code: "invalid_type",
          path: ["spans", 0, "timestamps", "started_at"],
          expected: "number",
          received: "string",
          message: "Expected number, received string",
        },
      ],
    };

    it("names the failing path with array indices", () => {
      expect(validationMeta(error)?.issues[0]?.path).toBe(
        "spans[0].timestamps.started_at",
      );
    });

    /** @scenario A field of the wrong type reports both types by name */
    it("reports both types by name", () => {
      const issue = validationMeta(error)?.issues[0];
      expect(issue?.expected).toBe("number");
      expect(issue?.received).toBe("string");
    });

    it("carries the issue code", () => {
      expect(validationMeta(error)?.issues[0]?.code).toBe("invalid_type");
    });
  });

  describe("when the schema refuses an unrecognised key", () => {
    const error = {
      issues: [
        {
          code: "unrecognized_keys",
          path: ["spans", 2],
          keys: ["vendor_latency_ms", "internal_hint"],
          message: "Unrecognized key(s) in object",
        },
      ],
    };

    /** @scenario A field we do not recognise is named */
    it("names the rejected keys", () => {
      expect(validationMeta(error)?.issues[0]?.keys).toEqual([
        "vendor_latency_ms",
        "internal_hint",
      ]);
    });

    it("reports the code so the rate can be aggregated", () => {
      expect(validationMeta(error)?.issues[0]?.code).toBe("unrecognized_keys");
    });
  });

  // The shapes below are captured verbatim from zod 4.4.3, which renamed the
  // codes the cases above match. This package takes no zod dependency on
  // purpose, so these stand in for the real emitter; without them the zod 4
  // branches read as covered while never having run.
  describe("when zod 4 reports a rejected enum", () => {
    const error = {
      issues: [
        {
          code: "invalid_value",
          values: ["llm", "chain", "tool"],
          path: ["spans", 0, "type"],
          message: 'Invalid option: expected one of "llm"|"chain"|"tool"',
        },
      ],
    };

    /** @scenario A rejected enum reports the options without the value */
    it("names the options the schema allows", () => {
      expect(validationMeta(error)?.issues[0]?.options).toEqual(["llm", "chain", "tool"]);
    });

    it("carries no value that arrived", () => {
      expect(validationMeta(error)?.issues[0]?.received).toBeUndefined();
    });
  });

  describe("when zod 4 reports a rejected discriminator", () => {
    const error = {
      issues: [
        {
          code: "invalid_union",
          note: "No matching discriminator",
          discriminator: "type",
          options: ["llm", "chain"],
          path: ["spans", 0, "type"],
          message: "Invalid discriminator value. Expected 'llm' | 'chain'",
        },
      ],
    };

    it("names the options the schema allows", () => {
      expect(validationMeta(error)?.issues[0]?.options).toEqual(["llm", "chain"]);
    });
  });

  describe("when zod 4 reports a malformed string", () => {
    const error = {
      issues: [
        {
          origin: "string",
          code: "invalid_format",
          format: "email",
          path: ["contact"],
          message: "Invalid email address",
        },
      ],
    };

    it("names the rule that rejected it", () => {
      expect(validationMeta(error)?.issues[0]?.rule).toBe("email");
    });
  });

  describe("when a value is not one of the allowed options", () => {
    const error = {
      issues: [
        {
          code: "invalid_enum_value",
          path: ["spans", 0, "type"],
          options: ["llm", "chain", "tool"],
          received: "customer-private-span-kind",
          message:
            "Invalid enum value. Expected 'llm' | 'chain' | 'tool', received 'customer-private-span-kind'",
        },
      ],
    };

    /** @scenario A rejected enum reports the options without the value */
    it("names the options the schema allows", () => {
      expect(validationMeta(error)?.issues[0]?.options).toEqual(["llm", "chain", "tool"]);
    });

    it("omits the value that arrived", () => {
      const serialised = JSON.stringify(validationMeta(error));
      expect(serialised).not.toContain("customer-private-span-kind");
    });

    it("omits zod's message, which embeds the value", () => {
      expect(validationMeta(error)?.issues[0]).not.toHaveProperty("message");
    });
  });

  describe("when the failure carries customer content", () => {
    it("keeps the value out of the metadata for every issue code", () => {
      const secret = "sk-live-DO-NOT-LOG";
      const error = {
        issues: [
          {
            code: "invalid_literal",
            path: ["a"],
            expected: "fixed",
            received: secret,
            message: `Invalid literal value, expected "fixed"`,
          },
          {
            code: "invalid_string",
            path: ["b"],
            validation: "url",
            message: "Invalid url",
          },
          {
            code: "custom",
            path: ["c"],
            params: { value: secret },
            message: `Rejected ${secret}`,
          },
        ],
      };

      expect(JSON.stringify(validationMeta(error))).not.toContain(secret);
    });

    it("keeps the declared literal, which is the schema's own", () => {
      const error = {
        issues: [
          {
            code: "invalid_literal",
            path: ["a"],
            expected: "fixed",
            received: "other",
          },
        ],
      };
      expect(validationMeta(error)?.issues[0]?.expected).toBe("fixed");
    });
  });

  describe("when a string rule or bound fails", () => {
    it("names the string rule", () => {
      const error = {
        issues: [{ code: "invalid_string", path: ["url"], validation: "url" }],
      };
      expect(validationMeta(error)?.issues[0]?.rule).toBe("url");
    });

    it("reports the minimum for too_small", () => {
      const error = {
        issues: [{ code: "too_small", path: ["name"], minimum: 1 }],
      };
      expect(validationMeta(error)?.issues[0]?.limit).toBe(1);
    });

    it("reports the maximum for too_big", () => {
      const error = {
        issues: [{ code: "too_big", path: ["name"], maximum: 128 }],
      };
      expect(validationMeta(error)?.issues[0]?.limit).toBe(128);
    });
  });

  describe("when the failure is a union", () => {
    it("follows the branch errors so the real reasons are visible", () => {
      const error = {
        issues: [
          {
            code: "invalid_union",
            path: ["input"],
            unionErrors: [
              {
                issues: [
                  {
                    code: "invalid_type",
                    path: ["input", "value"],
                    expected: "string",
                    received: "number",
                  },
                ],
              },
            ],
          },
        ],
      };

      const meta = validationMeta(error);
      expect(meta?.issueCount).toBe(2);
      expect(meta?.issues.map((i) => i.code)).toEqual(["invalid_union", "invalid_type"]);
    });
  });

  describe("when the root itself fails", () => {
    it("labels an empty path as the root", () => {
      const error = {
        issues: [
          {
            code: "invalid_type",
            path: [],
            expected: "object",
            received: "array",
          },
        ],
      };
      expect(validationMeta(error)?.issues[0]?.path).toBe("<root>");
    });
  });

  describe("when there are more issues than the log will carry", () => {
    const error = {
      issues: Array.from({ length: MAX_VALIDATION_ISSUES + 5 }, (_, i) => ({
        code: "invalid_type",
        path: ["spans", i, "name"],
        expected: "string",
        received: "undefined",
      })),
    };

    it("reports the total count", () => {
      expect(validationMeta(error)?.issueCount).toBe(MAX_VALIDATION_ISSUES + 5);
    });

    it("caps the entries it carries", () => {
      expect(validationMeta(error)?.issues).toHaveLength(MAX_VALIDATION_ISSUES);
    });

    /** @scenario Issue counts survive truncation */
    it("marks the record as truncated", () => {
      expect(validationMeta(error)?.truncated).toBe(true);
    });

    it("does not mark a record that fits as truncated", () => {
      const small = { issues: [{ code: "invalid_type", path: ["a"] }] };
      expect(validationMeta(small)).not.toHaveProperty("truncated");
    });
  });

  describe("when an unknown issue code arrives", () => {
    it("keeps the path and code without copying anything else", () => {
      const error = {
        issues: [
          {
            code: "some_future_code",
            path: ["a"],
            received: "customer value",
            message: "customer value",
          },
        ],
      };
      const issue = validationMeta(error)?.issues[0];
      expect(issue).toEqual({ path: "a", code: "some_future_code" });
    });
  });
});
