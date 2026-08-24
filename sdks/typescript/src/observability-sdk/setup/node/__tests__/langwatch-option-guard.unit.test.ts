/**
 * The `langwatch` option's disable sentinel, and what happens to a value that is
 * neither the sentinel nor an options object.
 *
 * `langwatch: "disabled"` turns the LangWatch exporter off. The resolution used
 * to be two lines:
 *
 *   const isDisabled = options.langwatch === 'disabled';
 *   const config = typeof options.langwatch === 'object' ? options.langwatch : {};
 *
 * A near-miss satisfied neither branch. `langwatch: "disable"` is not the
 * sentinel, so it did not disable; `typeof` said `string`, so `config` fell to
 * `{}`, `apiKey` came from `process.env.LANGWATCH_API_KEY`, and the exporter came
 * up against the caller's real endpoint. Someone who asked to send nothing sent
 * everything, and the only signal was the absence of one.
 *
 * TypeScript rejects that typo, which is why this is not a compile-time problem.
 * It is a runtime one: the value arrives from a config file, a JSON payload or
 * plain JavaScript, none of which the union protects.
 *
 * `null` was the mirror image. `typeof null === "object"`, so it passed the
 * object branch and threw a TypeError on the first property read, naming neither
 * the option nor the value.
 *
 * The assertions below are about the EXPORTER, not about a log line, because
 * "did we send data the caller asked us not to send" is the thing that matters.
 * LangWatchTraceExporter is mocked, so constructing it is observable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { setupObservability } from "../setup.js";
import { LANGWATCH_DISABLED } from "../types.js";
import { resetObservabilitySdkConfig } from "../../../config.js";
import { LangWatchTraceExporter } from "../../../exporters";

vi.mock("../../utils", () => ({
  isConcreteProvider: vi.fn(() => false),
  getConcreteProvider: vi.fn(() => undefined),
  createMergedResource: vi.fn(() => resourceFromAttributes({})),
}));
vi.mock("../../../exporters", () => ({
  LangWatchTraceExporter: vi.fn().mockImplementation(function () {
    return { shutdown: vi.fn() };
  }),
  LangWatchLogsExporter: vi.fn().mockImplementation(function () {
    return { shutdown: vi.fn() };
  }),
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: vi.fn().mockImplementation(function () {
    return { start: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
  }),
}));
vi.mock("../../../logger", () => ({
  setLangWatchLoggerProvider: vi.fn(),
}));

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const setup = (langwatch: unknown) =>
  setupObservability({
    serviceName: "svc",
    langwatch: langwatch as never,
    debug: { logger },
  });

const exporterWasConstructed = () =>
  vi.mocked(LangWatchTraceExporter).mock.calls.length > 0;

let previousApiKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  resetObservabilitySdkConfig();
  // The old fall-through only exported because an API key was reachable. Setting
  // one is what makes the regression visible rather than masked by an empty env.
  previousApiKey = process.env.LANGWATCH_API_KEY;
  process.env.LANGWATCH_API_KEY = "sk-lw-from-the-environment";
});

afterEach(() => {
  if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
  else process.env.LANGWATCH_API_KEY = previousApiKey;
});

describe("given the disable sentinel", () => {
  it("is the string the option's union accepts", () => {
    expect(LANGWATCH_DISABLED).toBe("disabled");
  });

  describe("when it is passed", () => {
    it("constructs no LangWatch exporter", () => {
      setup(LANGWATCH_DISABLED);
      expect(exporterWasConstructed()).toBe(false);
    });
  });
});

describe("given an options object", () => {
  it("constructs the exporter, so the guard has not disabled the ordinary path", () => {
    setup({ apiKey: "sk-lw-explicit" });
    expect(exporterWasConstructed()).toBe(true);
  });
});

describe("given a value that is neither the sentinel nor an options object", () => {
  const nearMisses: [string, unknown][] = [
    ["a typo of the sentinel", "disable"],
    ["a different casing", "Disabled"],
    ["the sentinel with whitespace", " disabled"],
    ["an unrelated string", "off"],
    ["the empty string", ""],
    ["null", null],
    ["a boolean", true],
    ["a number", 0],
  ];

  describe.each(nearMisses)("when it is %s", (_label, value) => {
    it("constructs no exporter, because it cannot be read as a request to export", () => {
      setup(value);
      expect(exporterWasConstructed()).toBe(false);
    });

    it("says so at error level, naming the value it rejected", () => {
      setup(value);
      const reported = logger.error.mock.calls.map(([message]) => String(message)).join("\n");
      expect(reported).toContain("Invalid `langwatch` option");
      expect(reported).toContain(JSON.stringify(value));
    });
  });

  it("does not throw on null, which used to reach a property read", () => {
    expect(() => setup(null)).not.toThrow();
  });
});
