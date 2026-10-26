/**
 * `HandledError.is` is how a module asks another module's error class whether it caught that
 * failure (platform-architecture-blocks.md, rule 2 idiom, Alex 2026-10-20): in process by
 * instance, and across a wire by the class's static code on the payload.
 */
import { describe, expect, it } from "vitest";

import { HandledError, handledErrorFromHerr, NotFoundError } from "../handled-error.ts";
import { readHandledError } from "../read-handled-error.ts";

class WidgetMissingError extends HandledError {
  static readonly code = "widget_missing" as const;
  declare readonly code: "widget_missing";

  constructor() {
    super("widget_missing", "Widget missing.", { httpStatus: 404 });
  }
}

class WidgetLockedError extends HandledError {
  static readonly code = "widget_locked" as const;
  declare readonly code: "widget_locked";

  constructor() {
    super("widget_locked", "Widget locked.", { httpStatus: 409 });
  }
}

/** A class that narrows nothing by code: no static code, so instance only. */
class CodelessError extends HandledError {
  constructor() {
    super("widget_missing", "Codeless.");
  }
}

const serialized = () => new WidgetMissingError().serialize();

/** Every transport shape a handled error reaches the browser in. */
const crossedAWire: [string, unknown][] = [
  [
    "a tRPC client error",
    Object.assign(new Error("widget_missing"), { data: { error: serialized() } }),
  ],
  ["a serialised payload", serialized()],
  ["a payload carrying only the deprecated kind", { kind: "widget_missing", httpStatus: 404 }],
  ["what readHandledError returns", readHandledError({ data: { error: serialized() } })],
  ["a canonical envelope nested under error", { error: { code: "widget_missing", message: "m" } }],
  ["a canonical envelope from a type-only writer", { error: { type: "widget_missing" } }],
  [
    "a canonical envelope at the body root",
    { type: "widget_missing", code: "widget_missing", retryable: false },
  ],
  ["a flat REST body", { error: "widget_missing", message: "Widget missing." }],
  [
    "a herr envelope turned into a HandledError",
    handledErrorFromHerr({ type: "widget_missing", message: "m" }),
  ],
];

describe("HandledError.is", () => {
  describe("when the error is an instance of the class", () => {
    it("matches", () => {
      expect(WidgetMissingError.is(new WidgetMissingError())).toBe(true);
    });
  });

  describe.each(crossedAWire)("when the error is %s carrying the class's code", (_, error) => {
    it("matches by the static code", () => {
      expect(WidgetMissingError.is(error)).toBe(true);
    });

    it("agrees with readHandledError on the code", () => {
      expect(readHandledError(error)?.code).toBe(WidgetMissingError.code);
    });

    it("does not match a class declaring another code", () => {
      expect(WidgetLockedError.is(error)).toBe(false);
    });
  });

  describe("when the error carries another code", () => {
    it("does not match", () => {
      expect(WidgetMissingError.is(new WidgetLockedError())).toBe(false);
      expect(WidgetMissingError.is({ data: { error: new WidgetLockedError().serialize() } })).toBe(
        false,
      );
      expect(WidgetMissingError.is({ error: "widget_locked" })).toBe(false);
    });
  });

  describe("when the value carries no handled payload", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string spelling the code", "widget_missing"],
      ["a plain error", new Error("widget_missing")],
      ["a bare object with only a code", { code: "widget_missing" }],
      ["a tRPC error whose payload has no status", { data: { error: { code: "widget_missing" } } }],
    ])("does not match %s", (_, error) => {
      expect(WidgetMissingError.is(error)).toBe(false);
    });
  });

  describe("when the class declares no static code", () => {
    it("matches instances only", () => {
      expect(CodelessError.is(new CodelessError())).toBe(true);
      expect(CodelessError.is(serialized())).toBe(false);
      expect(NotFoundError.is(serialized())).toBe(false);
      expect(HandledError.is(serialized())).toBe(false);
    });
  });
});
