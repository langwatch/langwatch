/**
 * Environment, enablement and instance identity resolution.
 *
 * @see specs/typescript-sdk/agent-wrapper.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { LANGWATCH_SDK_VERSION } from "../../internal/constants";
import {
  buildConnectHeaders,
  buildInstance,
  hostLabel,
  resolveConnectUrl,
  resolveEnabled,
  resolveEnvironment,
  resolveInstanceLabel,
  sanitizeEnvironment,
  USER_AGENT,
} from "../identity";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEnvironment()", () => {
  describe("when the option is given", () => {
    /** @scenario "The environment is the explicit option first" */
    it("wins over every environment variable", () => {
      expect(
        resolveEnvironment({
          explicit: "production",
          env: { LANGWATCH_AGENT_ENVIRONMENT: "staging" },
        }),
      ).toBe("production");
    });
  });

  describe("when nothing is set", () => {
    /** @scenario "The environment falls back through the environment variables" */
    it("is development", () => {
      expect(resolveEnvironment({ env: {} })).toBe("development");
    });
  });

  describe("when several variables are set", () => {
    /** @scenario "LANGWATCH_AGENT_ENVIRONMENT wins over APP_ENV, ENVIRONMENT and NODE_ENV" */
    it("reads them in order", () => {
      const env = {
        LANGWATCH_AGENT_ENVIRONMENT: "one",
        APP_ENV: "two",
        ENVIRONMENT: "three",
        NODE_ENV: "four",
      };
      expect(resolveEnvironment({ env })).toBe("one");
      expect(
        resolveEnvironment({ env: { APP_ENV: "two", ENVIRONMENT: "three", NODE_ENV: "four" } }),
      ).toBe("two");
      expect(resolveEnvironment({ env: { ENVIRONMENT: "three", NODE_ENV: "four" } })).toBe("three");
      expect(resolveEnvironment({ env: { NODE_ENV: "four" } })).toBe("four");
    });
  });
});

describe("sanitizeEnvironment()", () => {
  /** @scenario "The environment is sanitized" */
  it("lowercases, replaces what is not [a-z0-9_-], and cuts at 32", () => {
    expect(sanitizeEnvironment("My Staging/Env")).toBe("my-staging-env");
    expect(sanitizeEnvironment("a".repeat(40))).toHaveLength(32);
    expect(sanitizeEnvironment("  ")).toBe("development");
    expect(sanitizeEnvironment("prod_eu-1")).toBe("prod_eu-1");
  });
});

describe("resolveEnabled()", () => {
  /** @scenario "The connection is disabled on CI by default" */
  it("is off when CI is truthy and no option is given", () => {
    expect(resolveEnabled({ env: { CI: "true" } })).toBe(false);
    expect(resolveEnabled({ env: { CI: "1" } })).toBe(false);
    expect(resolveEnabled({ env: { CI: "false" } })).toBe(true);
    expect(resolveEnabled({ env: {} })).toBe(true);
    expect(resolveEnabled({ explicit: true, env: { CI: "true" } })).toBe(true);
  });

  /** @scenario "LANGWATCH_AGENT_CONNECT=0 disables the connection" */
  it("is off when LANGWATCH_AGENT_CONNECT is 0 or false, even with enabled true", () => {
    expect(resolveEnabled({ explicit: true, env: { LANGWATCH_AGENT_CONNECT: "0" } })).toBe(false);
    expect(resolveEnabled({ explicit: true, env: { LANGWATCH_AGENT_CONNECT: "false" } })).toBe(
      false,
    );
    expect(resolveEnabled({ env: { LANGWATCH_AGENT_CONNECT: "1" } })).toBe(true);
  });
});

describe("resolveInstanceLabel()", () => {
  /** @scenario "The instance label comes from the option or LANGWATCH_AGENT_INSTANCE_LABEL" */
  it("reads the option first, then the variable", () => {
    expect(
      resolveInstanceLabel({ explicit: "green", env: { LANGWATCH_AGENT_INSTANCE_LABEL: "blue" } }),
    ).toBe("green");
    expect(resolveInstanceLabel({ env: { LANGWATCH_AGENT_INSTANCE_LABEL: "blue" } })).toBe("blue");
    expect(resolveInstanceLabel({ env: {} })).toBeUndefined();
  });
});

describe("buildInstance()", () => {
  /** @scenario "The hostname is sent as a host label" */
  it("sends the hostname as a lowercase host label", () => {
    const machineNamed = (name: string) => ({
      hostname: () => name,
      userInfo: () => ({ username: "dev" }),
    });

    expect(buildInstance({ machine: machineNamed("ACME-Laptop.home") }).hostname).toBe(
      "acme-laptop",
    );
    expect(hostLabel("ip-10-0-1-23.eu-west-1.compute.internal")).toBe("ip-10-0-1-23-eu-west-1-c");
    expect(hostLabel("a".repeat(40))).toHaveLength(24);
    expect(hostLabel("--Pod A--")).toBe("pod-a");
  });

  /** @scenario "The instance identity is read defensively" */
  it("carries an empty hostname when the machine refuses to name itself", () => {
    expect(typeof buildInstance({}).hostname).toBe("string");
    const machine = {
      hostname: () => {
        throw new Error("no hostname");
      },
      userInfo: () => {
        throw new Error("no passwd entry");
      },
    };

    const instance = buildInstance({ label: "blue", machine });

    expect(instance.hostname).toBe("");
    expect(instance.username).toBe("");
    expect(instance.id).toMatch(/^inst_[0-9a-f]{32}$/);
    expect(instance.pid).toBe(process.pid);
    expect(Date.parse(instance.startedAt)).not.toBeNaN();
    expect(instance.label).toBe("blue");
    expect(instance.inFlightCallIds).toEqual([]);
  });
});

describe("resolveConnectUrl()", () => {
  /** @scenario "The connect URL is derived from the endpoint" */
  it("turns https into wss and http into ws, on /api/v1/agents/connect", () => {
    expect(resolveConnectUrl("https://app.langwatch.ai")).toBe(
      "wss://app.langwatch.ai/api/v1/agents/connect",
    );
    expect(resolveConnectUrl("http://localhost:5560")).toBe(
      "ws://localhost:5560/api/v1/agents/connect",
    );
    expect(resolveConnectUrl("http://localhost:5560/")).toBe(
      "ws://localhost:5560/api/v1/agents/connect",
    );
  });
});

describe("buildConnectHeaders()", () => {
  /** @scenario "The socket carries the API key, the project id and the SDK user agent" */
  it("carries the bearer key, the project id when given, and the SDK user agent", () => {
    expect(buildConnectHeaders({ apiKey: "sk-lw-x", projectId: "proj_1" })).toEqual({
      Authorization: "Bearer sk-lw-x",
      "X-Project-Id": "proj_1",
      "User-Agent": `langwatch-typescript/${LANGWATCH_SDK_VERSION}`,
    });
    expect(buildConnectHeaders({ apiKey: "sk-lw-x" })).not.toHaveProperty("X-Project-Id");
    expect(USER_AGENT).toBe(`langwatch-typescript/${LANGWATCH_SDK_VERSION}`);
  });
});
