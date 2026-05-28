import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_SPANS_PER_TRACE,
  readMaxSpansPerTrace,
} from "../trace-span-bound.service";

const ENV = "LANGWATCH_MAX_SPANS_PER_TRACE";

describe("readMaxSpansPerTrace", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV];
    delete process.env[ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  describe("given the bound is not configured", () => {
    /** @scenario The bound defaults ON when unconfigured */
    it("returns the built-in default ceiling", () => {
      expect(readMaxSpansPerTrace()).toBe(DEFAULT_MAX_SPANS_PER_TRACE);
    });

    it("falls back to the default for an empty value", () => {
      process.env[ENV] = "";
      expect(readMaxSpansPerTrace()).toBe(DEFAULT_MAX_SPANS_PER_TRACE);
    });

    it("falls back to the default for a non-numeric value", () => {
      process.env[ENV] = "lots";
      expect(readMaxSpansPerTrace()).toBe(DEFAULT_MAX_SPANS_PER_TRACE);
    });

    it("falls back to the default for a negative value", () => {
      process.env[ENV] = "-5";
      expect(readMaxSpansPerTrace()).toBe(DEFAULT_MAX_SPANS_PER_TRACE);
    });
  });

  describe("given an operator configures the bound", () => {
    /** @scenario An operator can retune the bound */
    it("returns the configured ceiling", () => {
      process.env[ENV] = "500";
      expect(readMaxSpansPerTrace()).toBe(500);
    });

    it("returns 0 as the explicit kill switch", () => {
      process.env[ENV] = "0";
      expect(readMaxSpansPerTrace()).toBe(0);
    });
  });
});
