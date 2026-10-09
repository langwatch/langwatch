// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseZodFieldErrors } from "../zod-field-errors.ts";

describe("parseZodFieldErrors", () => {
  describe("when a required string is empty", () => {
    it("shows a human message instead of the raw Zod text", () => {
      const errors = parseZodFieldErrors({
        issues: [
          {
            code: "too_small",
            minimum: 1,
            path: ["OPENAI_API_KEY"],
            message: "Too small: expected string to have >=1 characters",
          },
        ],
      });

      expect(errors).toEqual({ OPENAI_API_KEY: "This field is required" });
    });
  });
});
