/**
 * Pins SDK protocol.ts against platform's connected-agent.protocol.ts to
 * prevent frame shape drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION } from "../protocol";

const PLATFORM_PROTOCOL = resolve(
  __dirname,
  "../../../../../modules/agent/contract/src/connected-agent.protocol.ts",
);
const SDK_PROTOCOL = resolve(__dirname, "../protocol.ts");
const SDK_CLIENT = resolve(__dirname, "../client.ts");

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
function platformKeys({ source, schema }: { source: string; schema: string }): string[] {
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
    level += (trimmed.match(/[{(]/g) ?? []).length - (trimmed.match(/[})]/g) ?? []).length;
  }
  return keys;
}

/**
 * The top-level keys of one interface in the SDK source, read by matching
 * braces -- an inline object type like `meta?: { projects: unknown[] }`
 * neither cuts the list short nor adds its nested keys.
 */
function sdkKeys({ source, name }: { source: string; name: string }): string[] {
  const start = new RegExp(`export interface ${name}\\s*\\{`).exec(source);
  if (!start) throw new Error(`SDK protocol has no interface ${name}`);
  const body = bracedBody({ source, from: start.index });
  const keys: string[] = [];
  let level = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (level === 0) {
      const match = /^(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(trimmed);
      if (match) keys.push(match[1]!);
    }
    level += (trimmed.match(/[{(]/g) ?? []).length - (trimmed.match(/[})]/g) ?? []).length;
  }
  return keys;
}

const sorted = (keys: string[]): string[] => [...keys].toSorted();

const withoutType = (keys: string[]): string[] => keys.filter((key) => key !== "type");

/** A published SDK checkout carries no platform packages; the drift check runs in the monorepo. */
const readIfPresent = (file: string): string =>
  existsSync(file) ? readFileSync(file, "utf8") : "";

describe.skipIf(!existsSync(PLATFORM_PROTOCOL))(
  "the SDK protocol, given the platform's protocol module",
  () => {
    const platform = readIfPresent(PLATFORM_PROTOCOL);
    const sdk = readIfPresent(SDK_PROTOCOL);

    it("speaks the same protocol version", () => {
      const match = /export const PROTOCOL_VERSION = (\d+);/.exec(platform);
      expect(Number(match?.[1])).toBe(PROTOCOL_VERSION);
    });

    it("knows every frame type the platform names", () => {
      const platformTypes = [
        ...new Set(
          [...platform.matchAll(/type: z\.literal\("([a-z_]+)"\)/g)].map((entry) => entry[1]!),
        ),
      ].toSorted();
      const sdkTypes = [
        ...new Set([...sdk.matchAll(/type: "([a-z_]+)";/g)].map((entry) => entry[1]!)),
      ].toSorted();
      expect(sdkTypes).toEqual(platformTypes);
      expect(sdkTypes).toEqual([
        "ack",
        "call",
        "cancel",
        "deregister",
        "refused",
        "register",
        "registered",
        "result",
      ]);
    });

    describe("when the frames the SDK sends are compared", () => {
      it("register carries the same sdk, instance and agent keys", () => {
        expect(sorted(sdkKeys({ source: sdk, name: "RegisterSdk" }))).toEqual(
          sorted(platformKeys({ source: platform, schema: "sdkSchema" })),
        );
        // The platform also accepts an optional maxConcurrency the SDK does not send.
        const instanceKeys = platformKeys({
          source: platform,
          schema: "registerInstanceSchema",
        }).filter((key) => key !== "maxConcurrency");
        expect(sorted(sdkKeys({ source: sdk, name: "RegisterInstance" }))).toEqual(
          sorted(instanceKeys),
        );
        expect(sorted(sdkKeys({ source: sdk, name: "RegisterAgent" }))).toEqual(
          sorted(platformKeys({ source: platform, schema: "registerAgentSchema" })),
        );
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "RegisterFrame" })))).toEqual(
          sorted([
            "protocol",
            ...withoutType(platformKeys({ source: platform, schema: "registerFrameSchema" })),
          ]),
        );
      });

      it("ack, result and deregister carry the same keys", () => {
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "AckFrame" })))).toEqual(
          sorted([
            "protocol",
            ...withoutType(platformKeys({ source: platform, schema: "ackFrameSchema" })),
          ]),
        );
        const resultKeys = withoutType(
          platformKeys({ source: platform, schema: "resultFrameSchema" }),
        );
        expect(sorted(resultKeys)).toEqual(sorted(["callId", "output", "session", "error"]));
        expect(sorted(sdkKeys({ source: sdk, name: "CallError" }))).toEqual(
          sorted(platformKeys({ source: platform, schema: "resultErrorSchema" })),
        );
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "DeregisterFrame" })))).toEqual([
          "protocol",
        ]);
      });
    });

    describe("when the frames the SDK receives are compared", () => {
      it("registered carries the same keys", () => {
        const keys = withoutType(
          platformKeys({ source: platform, schema: "registeredFrameSchema" }),
        );
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "RegisteredFrame" })))).toEqual(
          sorted(["protocol", ...keys]),
        );
        expect(sorted(sdkKeys({ source: sdk, name: "RegisteredAgent" }))).toEqual(
          sorted(["name", "environment", "id", "url", "parameterNotes"]),
        );
      });

      it("refused carries the same keys", () => {
        const keys = withoutType(platformKeys({ source: platform, schema: "refusedFrameSchema" }));
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "RefusedFrame" })))).toEqual(
          sorted(["protocol", ...keys]),
        );
      });

      it("call carries the envelope keys and nothing else", () => {
        const envelope = platformKeys({ source: platform, schema: "callEnvelopeSchema" });
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "CallFrame" })))).toEqual(
          sorted(["protocol", ...envelope]),
        );
        expect(sorted(sdkKeys({ source: sdk, name: "CallRun" }))).toEqual(
          sorted(platformKeys({ source: platform, schema: "callRunSchema" })),
        );
      });

      it("cancel carries the same keys", () => {
        const keys = withoutType(platformKeys({ source: platform, schema: "cancelFrameSchema" }));
        expect(sorted(withoutType(sdkKeys({ source: sdk, name: "CancelFrame" })))).toEqual(
          sorted(["protocol", ...keys]),
        );
      });

      it("names every refusal code the platform can send", () => {
        const listed = /REFUSED_CODES = \[([^\]]*)\]/.exec(platform)?.[1] ?? "";
        const codes = [...listed.matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1]!);
        expect(codes.length).toBeGreaterThan(0);
        const client = readFileSync(SDK_CLIENT, "utf8");
        for (const code of codes) {
          expect(client, `refusalAdvice has no case for ${code}`).toContain(`case "${code}":`);
        }
      });
    });
  },
);
