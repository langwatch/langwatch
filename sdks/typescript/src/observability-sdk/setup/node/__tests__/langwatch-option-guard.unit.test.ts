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
 * the option nor the value. An array passed that branch too, and worse: it read
 * as a configuration whose every field was `undefined`, so the exporter came up
 * on the environment's API key with nothing reported at all.
 *
 * Reporting a rejected value is its own hazard. `JSON.stringify` throws on a
 * BigInt, so naming the value that way turned the diagnostic into an unrelated
 * serialisation error.
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
  // The third column is the KIND the report must name. It is never the value
  // itself: `langwatch: process.env.LANGWATCH_API_KEY` is an easy thing to
  // write by mistake, and echoing the value would put the key in the logs.
  const nearMisses: [string, unknown, string][] = [
    ["a typo of the sentinel", "disable", "a string"],
    ["a different casing", "Disabled", "a string"],
    ["the sentinel with whitespace", " disabled", "a string"],
    ["an unrelated string", "off", "a string"],
    ["the empty string", "", "a string"],
    ["null", null, "null"],
    ["a boolean", true, "a boolean"],
    ["a number", 0, "a number"],
    ["a bigint", BigInt(1), "a bigint"],
    ["a symbol", Symbol("nope"), "a symbol"],
    ["a function", () => undefined, "a function"],
    ["an array", [], "an array"],
    ["a Date", new Date(), "a Date"],
    ["a Map", new Map(), "a Map"],
    ["a Set", new Set(), "a Set"],
    ["a regular expression", /nope/, "a RegExp"],
    ["a boxed string", new String("disabled"), "a String"],
  ];

  describe.each(nearMisses)("when it is %s", (_label, value, rendered) => {
    it("constructs no exporter, because it cannot be read as a request to export", () => {
      setup(value);
      expect(exporterWasConstructed()).toBe(false);
    });

    it("says so at error level, naming the value it rejected", () => {
      setup(value);
      const reported = logger.error.mock.calls.map(([message]) => String(message)).join("\n");
      expect(reported).toContain("Invalid `langwatch` option");
      expect(reported).toContain(rendered);
    });
  });

  it("does not throw on null, which used to reach a property read", () => {
    expect(() => setup(null)).not.toThrow();
  });

  it("does not throw on a value JSON cannot serialise, which the report itself used to hit", () => {
    expect(() => setup(BigInt(1))).not.toThrow();
  });

  it("never echoes the value, because an API key is an easy thing to pass here by mistake", () => {
    setup(process.env.LANGWATCH_API_KEY);
    const reported = logger.error.mock.calls.map(([message]) => String(message)).join("\n");
    expect(reported).toContain("Invalid `langwatch` option");
    expect(reported).not.toContain("sk-lw-from-the-environment");
  });
});

describe("given a value that cannot even be inspected", () => {
  const revoked = () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    return proxy;
  };

  it("constructs no exporter, because a value that throws on every question is not a configuration", () => {
    setup(revoked());
    expect(exporterWasConstructed()).toBe(false);
  });

  it("does not throw, so the guard disables setup rather than taking it down", () => {
    expect(() => setup(revoked())).not.toThrow();
  });

  it("is still reported, naming it as an object", () => {
    setup(revoked());
    const reported = logger.error.mock.calls.map(([message]) => String(message)).join("\n");
    expect(reported).toContain("Invalid `langwatch` option");
    expect(reported).toContain("an object");
  });
});

describe("given an object whose type name the caller controls", () => {
  it("reports the runtime's type, not the caller's string, which could be a key", () => {
    const tampered = new Date(0);
    (tampered as unknown as { constructor: unknown }).constructor = {
      name: "sk-lw-from-the-environment",
    };
    setup(tampered);

    const reported = logger.error.mock.calls.map(([message]) => String(message)).join("\n");
    expect(reported).toContain("a Date");
    expect(reported).not.toContain("sk-lw-from-the-environment");
  });

  it("ignores a forged toStringTag for the same reason", () => {
    // Not a plain object literal: that would be accepted as options and would
    // report nothing, so the assertion would pass without testing anything.
    class Tagged {
      get [Symbol.toStringTag](): string {
        return "sk-lw-from-the-environment";
      }
    }
    setup(new Tagged());

    const reported = logger.error.mock.calls.map(([message]) => String(message)).join("\n");
    expect(reported).toContain("Invalid `langwatch` option");
    expect(reported).toContain("an object");
    expect(reported).not.toContain("sk-lw-from-the-environment");
  });
});

describe("given an array carrying an option key", () => {
  it("is still rejected, because an array is never a configuration record", () => {
    setup(Object.assign([] as unknown[], { apiKey: "sk-lw-explicit" }));
    expect(exporterWasConstructed()).toBe(false);
  });
});

describe("given an object that is not a plain record but carries an option key", () => {
  it("still configures the exporter, so a configuration built by a class is not broken", () => {
    class Options {
      apiKey = "sk-lw-explicit";
    }
    setup(new Options());
    expect(exporterWasConstructed()).toBe(true);
  });
});

describe("given a record with a null prototype", () => {
  it("is read as options, because JSON and Object.create(null) both produce one", () => {
    setup(Object.assign(Object.create(null) as object, { apiKey: "sk-lw-explicit" }));
    expect(exporterWasConstructed()).toBe(true);
  });
});
