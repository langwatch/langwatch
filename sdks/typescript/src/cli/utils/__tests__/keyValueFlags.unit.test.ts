/**
 * The coercion rule is the interesting part: a run parameter that LOOKS
 * numeric is not always a number, and turning an order id like `007` into `7`
 * hands the target under test a different value than the caller typed. The
 * round-trip check is what draws that line, so it is pinned here rather than
 * inferred from one command's behavior.
 *
 * Spec: specs/scenarios/scenario-run-parameters.feature
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  coerceParameterValue,
  parseKeyValueFlags,
  parseRunParameterFlags,
} from "../keyValueFlags";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("coerceParameterValue()", () => {
  describe("given a value that is exactly true or false", () => {
    it("reads it as a boolean", () => {
      expect(coerceParameterValue("true")).toBe(true);
      expect(coerceParameterValue("false")).toBe(false);
    });
  });

  describe("given a value that only resembles a boolean", () => {
    it("keeps it as text", () => {
      expect(coerceParameterValue("TRUE")).toBe("TRUE");
      expect(coerceParameterValue("yes")).toBe("yes");
    });
  });

  describe("given a plain number", () => {
    it("reads it as a number", () => {
      expect(coerceParameterValue("12")).toBe(12);
      expect(coerceParameterValue("-3")).toBe(-3);
      expect(coerceParameterValue("1.5")).toBe(1.5);
      expect(coerceParameterValue("0")).toBe(0);
    });
  });

  describe("given an identifier that merely looks numeric", () => {
    it("keeps it as text, so the run receives what was typed", () => {
      expect(coerceParameterValue("007")).toBe("007");
      expect(coerceParameterValue("1.50")).toBe("1.50");
      expect(coerceParameterValue("0x10")).toBe("0x10");
      expect(coerceParameterValue("1e5")).toBe("1e5");
      expect(coerceParameterValue("12345678901234567890")).toBe(
        "12345678901234567890",
      );
      expect(coerceParameterValue(" 5")).toBe(" 5");
      expect(coerceParameterValue("")).toBe("");
      expect(coerceParameterValue("Infinity")).toBe("Infinity");
    });
  });
});

describe("parseRunParameterFlags()", () => {
  describe("given no flags", () => {
    it("supplies nothing at all rather than an empty record", () => {
      expect(parseRunParameterFlags({ pairs: undefined })).toBeUndefined();
      expect(parseRunParameterFlags({ pairs: [] })).toBeUndefined();
    });
  });

  describe("given a value containing an equals sign", () => {
    it("splits on the first one, so the value keeps the rest", () => {
      expect(
        parseRunParameterFlags({ pairs: ["query=a=b"] }),
      ).toEqual({ query: "a=b" });
    });
  });

  describe("given an empty value", () => {
    it("supplies the empty string, which is a value a scenario may want", () => {
      expect(parseRunParameterFlags({ pairs: ["note="] })).toEqual({
        note: "",
      });
    });
  });

  describe("given __proto__ as the name", () => {
    it("supplies it as an ordinary key rather than dropping it", () => {
      // Assigned onto an object literal this reaches the prototype setter,
      // which ignores a string, so the pair would vanish without a word
      // instead of reaching the server that rejects the name by hand.
      const parsed = parseRunParameterFlags({ pairs: ["__proto__=gold"] });

      expect(parsed?.__proto__).toBe("gold");
      expect(Object.keys(parsed ?? {})).toEqual(["__proto__"]);
    });
  });

  describe("given the same name twice", () => {
    it("keeps the last value, so an appended override wins", () => {
      expect(
        parseRunParameterFlags({ pairs: ["region=us-east", "region=eu-central"] }),
      ).toEqual({ region: "eu-central" });
    });
  });

  describe("given a pair with no equals sign", () => {
    it("ends the command instead of guessing what was meant", () => {
      expect(() => parseRunParameterFlags({ pairs: ["region"] })).toThrow(
        ProcessExitError,
      );
    });
  });

  describe("given a pair with an empty name", () => {
    it("ends the command, since no scenario can declare a nameless parameter", () => {
      expect(() => parseRunParameterFlags({ pairs: ["=eu-central"] })).toThrow(
        ProcessExitError,
      );
    });
  });
});

describe("parseKeyValueFlags()", () => {
  describe("given one key repeated", () => {
    it("collects every value under that key", () => {
      expect(
        parseKeyValueFlags({
          pairs: ["tier=gold", "tier=silver", "region=eu"],
          flag: "--metadata",
        }),
      ).toEqual({ tier: ["gold", "silver"], region: ["eu"] });
    });
  });

  describe("given a key containing a colon", () => {
    it("ends the command, since the pair would address a different key", () => {
      expect(() =>
        parseKeyValueFlags({ pairs: ["a:b=gold"], flag: "--metadata" }),
      ).toThrow(ProcessExitError);
    });
  });

  describe("given an empty value", () => {
    it("ends the command, since it would match every request lacking the key", () => {
      expect(() =>
        parseKeyValueFlags({ pairs: ["tier="], flag: "--metadata" }),
      ).toThrow(ProcessExitError);
    });
  });

  describe("given __proto__ as the key", () => {
    it("collects it as an ordinary key", () => {
      const parsed = parseKeyValueFlags({
        pairs: ["__proto__=gold", "__proto__=silver"],
        flag: "--metadata",
      });

      expect(parsed?.__proto__).toEqual(["gold", "silver"]);
      expect(Object.keys({}).length).toBe(0);
    });
  });
});
