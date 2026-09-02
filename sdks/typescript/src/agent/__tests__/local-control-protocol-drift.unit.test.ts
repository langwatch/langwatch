/**
 * The CLI's local control frames against the platform's contract module.
 *
 * `platform/app/src/server/langy-local-control/protocol.ts` is the contract;
 * `src/agent/local-control-protocol.ts` is the CLI's copy. This test reads the
 * platform source from the repository and pins the frame type names, the
 * top-level keys of every frame and the budgets the CLI copied, so the two
 * cannot drift apart without a failing test. It compares key lists read from
 * the source text, never the zod objects. A published SDK checkout has no
 * platform tree, so the test skips there and says so.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  BASH_OUTPUT_CAP_BYTES,
  LOCAL_CALL_ERROR_CODES,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_REFUSED_CODES,
  LOCAL_LOG_DIR,
  LOCAL_TOOL_NAMES,
  PERMISSION_DECISIONS,
  PRESENCE_HEARTBEAT_MS,
} from "../local-control-protocol";

const PLATFORM_DIR = resolve(
  __dirname,
  "../../../../../platform/app/src/server/langy-local-control",
);
const PLATFORM_PROTOCOL = resolve(PLATFORM_DIR, "protocol.ts");
const PLATFORM_CONSTANTS = resolve(PLATFORM_DIR, "constants.ts");
const CLI_PROTOCOL = resolve(__dirname, "../local-control-protocol.ts");

/** The text between one brace and the brace that closes it, braces excluded. */
function bracedBody({ source, from }: { source: string; from: number }): string {
  const open = source.indexOf("{", from);
  if (open === -1) throw new Error("no brace after the declaration");
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(open + 1, end);
}

/** The top-level keys of one zod object literal in the platform source, by schema name. */
function platformKeys({
  source,
  schema,
}: {
  source: string;
  schema: string;
}): string[] {
  const start = source.indexOf(`export const ${schema} =`);
  if (start === -1) throw new Error(`platform protocol has no ${schema}`);
  const body = bracedBody({ source, from: start });
  const keys: string[] = [];
  let level = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (level === 0) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed);
      if (match) keys.push(match[1]!);
    }
    level +=
      (trimmed.match(/[{(]/g) ?? []).length -
      (trimmed.match(/[})]/g) ?? []).length;
  }
  return keys;
}

/** The top-level keys of one TypeScript interface in the CLI source, by name. */
function cliKeys({ source, name }: { source: string; name: string }): string[] {
  const start = new RegExp(`export interface ${name}\\s*\\{`).exec(source);
  if (!start) throw new Error(`the CLI protocol has no interface ${name}`);
  const body = bracedBody({ source, from: start.index });
  const keys: string[] = [];
  let level = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (level === 0) {
      const match = /^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(trimmed);
      if (match) keys.push(match[1]!);
    }
    level +=
      (trimmed.match(/[{(]/g) ?? []).length -
      (trimmed.match(/[})]/g) ?? []).length;
  }
  return keys;
}

const sorted = (keys: string[]): string[] => [...keys].sort();

const withoutType = (keys: string[]): string[] =>
  keys.filter((key) => key !== "type");

/** The string entries of one `export const NAME = [...] as const` list. */
function stringList({
  source,
  name,
}: {
  source: string;
  name: string;
}): string[] {
  const listed = new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(source)?.[1] ?? "";
  return [...listed.matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1]!);
}

/**
 * One numeric constant of the platform's constants module. The budgets are
 * written as sums of products (`5 * 60 * 1000`), which is all this reads.
 */
function platformNumber({
  source,
  name,
}: {
  source: string;
  name: string;
}): number {
  const match = new RegExp(`export const ${name} = ([^;]+);`).exec(source);
  if (!match) throw new Error(`the platform constants have no ${name}`);
  const expression = match[1]!.replace(/_/g, "");
  if (!/^[\d\s*+]+$/.test(expression)) {
    throw new Error(`${name} is not a sum of products`);
  }
  return expression
    .split("+")
    .map((term) =>
      term
        .split("*")
        .map((factor) => Number(factor.trim()))
        .reduce((left, right) => left * right, 1),
    )
    .reduce((left, right) => left + right, 0);
}

describe("the CLI local control protocol, given the platform's contract module", () => {
  if (!existsSync(PLATFORM_PROTOCOL)) {
    it.skip("matches the platform contract (skipped: no platform tree in this checkout)", () => {
      // A published SDK checkout carries no platform/app; the drift check runs in the monorepo.
    });
    return;
  }

  const platform = readFileSync(PLATFORM_PROTOCOL, "utf8");
  const constants = readFileSync(PLATFORM_CONSTANTS, "utf8");
  const cli = readFileSync(CLI_PROTOCOL, "utf8");

  it("speaks the same protocol version", () => {
    const match = /export const LOCAL_CONTROL_PROTOCOL_VERSION = (\d+);/.exec(
      platform,
    );
    expect(Number(match?.[1])).toBe(LOCAL_CONTROL_PROTOCOL_VERSION);
  });

  it("knows every frame type the platform names", () => {
    const platformTypes = [
      ...new Set(
        [...platform.matchAll(/type: z\.literal\("([a-z_]+)"\)/g)].map(
          (entry) => entry[1]!,
        ),
      ),
    ].sort();
    const cliTypes = [
      ...new Set(
        [...cli.matchAll(/type: "([a-z_]+)";/g)].map((entry) => entry[1]!),
      ),
    ].sort();
    expect(cliTypes).toEqual(platformTypes);
    expect(cliTypes).toEqual([
      "ack",
      "call",
      "cancel",
      "deregister",
      "disconnect",
      "permission",
      "permission_required",
      "policy",
      "refused",
      "register",
      "registered",
      "result",
    ]);
  });

  it("names every tool the platform lists", () => {
    expect([...LOCAL_TOOL_NAMES]).toEqual(
      stringList({ source: platform, name: "LOCAL_TOOL_NAMES" }),
    );
  });

  describe("when the frames the CLI sends are compared", () => {
    it("register carries the same cli, instance and workspace keys", () => {
      expect(sorted(cliKeys({ source: cli, name: "LocalControlCli" }))).toEqual(
        sorted(platformKeys({ source: platform, schema: "cliSchema" })),
      );
      expect(
        sorted(cliKeys({ source: cli, name: "LocalRegisterInstance" })),
      ).toEqual(
        sorted(
          platformKeys({ source: platform, schema: "registerInstanceSchema" }),
        ),
      );
      expect(sorted(cliKeys({ source: cli, name: "WorkspaceInfo" }))).toEqual(
        sorted(platformKeys({ source: platform, schema: "workspaceInfoSchema" })),
      );
      expect(
        sorted(withoutType(cliKeys({ source: cli, name: "LocalRegisterFrame" }))),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({ source: platform, schema: "registerFrameSchema" }),
          ),
        ]),
      );
    });

    it("ack, result and deregister carry the same keys", () => {
      expect(
        sorted(withoutType(cliKeys({ source: cli, name: "LocalAckFrame" }))),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({ source: platform, schema: "ackFrameSchema" }),
          ),
        ]),
      );
      expect(
        sorted(withoutType(cliKeys({ source: cli, name: "LocalResultFrame" }))),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({ source: platform, schema: "resultFrameSchema" }),
          ),
        ]),
      );
      expect(sorted(cliKeys({ source: cli, name: "LocalCallError" }))).toEqual(
        sorted(platformKeys({ source: platform, schema: "localCallErrorSchema" })),
      );
      expect(sorted(cliKeys({ source: cli, name: "BashOutput" }))).toEqual(
        sorted(platformKeys({ source: platform, schema: "bashOutputSchema" })),
      );
      expect(
        sorted(
          withoutType(cliKeys({ source: cli, name: "LocalDeregisterFrame" })),
        ),
      ).toEqual(["protocol"]);
    });

    it("permission_required carries the same keys", () => {
      expect(
        sorted(
          withoutType(
            cliKeys({ source: cli, name: "LocalPermissionRequiredFrame" }),
          ),
        ),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({
              source: platform,
              schema: "permissionRequiredFrameSchema",
            }),
          ),
        ]),
      );
    });

    it("names every call error code the platform can carry", () => {
      expect([...LOCAL_CALL_ERROR_CODES]).toEqual(
        stringList({ source: platform, name: "LOCAL_CALL_ERROR_CODES" }),
      );
    });
  });

  describe("when the frames the CLI receives are compared", () => {
    it("registered carries the same keys", () => {
      expect(
        sorted(
          withoutType(cliKeys({ source: cli, name: "LocalRegisteredFrame" })),
        ),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({ source: platform, schema: "registeredFrameSchema" }),
          ),
        ]),
      );
    });

    it("refused carries the same keys and every refusal code has advice", () => {
      expect(
        sorted(withoutType(cliKeys({ source: cli, name: "LocalRefusedFrame" }))),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({ source: platform, schema: "refusedFrameSchema" }),
          ),
        ]),
      );
      const codes = stringList({
        source: platform,
        name: "LOCAL_CONTROL_REFUSED_CODES",
      });
      expect(codes.length).toBeGreaterThan(0);
      expect([...LOCAL_CONTROL_REFUSED_CODES]).toEqual(codes);
      for (const code of codes) {
        expect(cli, `localRefusalAdvice has no case for ${code}`).toContain(
          `case "${code}":`,
        );
      }
    });

    it("call carries the envelope keys and nothing else", () => {
      const envelope = platformKeys({
        source: platform,
        schema: "callEnvelopeSchema",
      });
      expect(sorted(cliKeys({ source: cli, name: "LocalCallEnvelope" }))).toEqual(
        sorted(envelope),
      );
      expect(
        sorted(withoutType(cliKeys({ source: cli, name: "LocalCallFrame" }))),
      ).toEqual(
        sorted([
          "protocol",
          ...withoutType(
            platformKeys({ source: platform, schema: "callFrameSchema" }),
          ),
        ]),
      );
    });

    it("cancel, permission, policy and disconnect carry the same keys", () => {
      const pairs: Array<[string, string]> = [
        ["LocalCancelFrame", "cancelFrameSchema"],
        ["LocalPermissionFrame", "permissionFrameSchema"],
        ["LocalPolicyFrame", "policyFrameSchema"],
        ["LocalDisconnectFrame", "disconnectFrameSchema"],
      ];
      for (const [name, schema] of pairs) {
        expect(sorted(withoutType(cliKeys({ source: cli, name })))).toEqual(
          sorted([
            "protocol",
            ...withoutType(platformKeys({ source: platform, schema })),
          ]),
        );
      }
    });

    it("names every permission decision the platform can send", () => {
      expect([...PERMISSION_DECISIONS]).toEqual(
        stringList({ source: platform, name: "PERMISSION_DECISIONS" }),
      );
    });
  });

  describe("when the budgets the CLI copied are compared", () => {
    it("uses the platform's numbers", () => {
      expect(BASH_OUTPUT_CAP_BYTES).toBe(
        platformNumber({ source: constants, name: "BASH_OUTPUT_CAP_BYTES" }),
      );
      expect(BASH_DEFAULT_TIMEOUT_MS).toBe(
        platformNumber({ source: constants, name: "BASH_DEFAULT_TIMEOUT_MS" }),
      );
      expect(BASH_MAX_TIMEOUT_MS).toBe(
        platformNumber({ source: constants, name: "BASH_MAX_TIMEOUT_MS" }),
      );
      expect(PRESENCE_HEARTBEAT_MS).toBe(
        platformNumber({ source: constants, name: "PRESENCE_HEARTBEAT_MS" }),
      );
    });

    it("writes its logs where the platform says", () => {
      const match = /export const LOCAL_LOG_DIR = "([^"]+)";/.exec(constants);
      expect(match?.[1]).toBe(LOCAL_LOG_DIR);
    });
  });
});
