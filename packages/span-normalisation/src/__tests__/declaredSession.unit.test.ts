/**
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";

import { readDeclaredSessionKey } from "../langwatch/langwatchIdentity.ts";

describe("readDeclaredSessionKey()", () => {
  /** @scenario a launcher's declared session groups every harness session it runs */
  it("reads the record first, then the resource", () => {
    expect(
      readDeclaredSessionKey({
        attributes: { "langwatch.session.id": "agent_scout" },
        resourceAttributes: { "langwatch.session.id": "agent_other" },
      }),
    ).toBe("agent_scout");
    expect(
      readDeclaredSessionKey({
        attributes: new Map([["session.id", "s-1"]]),
        resourceAttributes: { "langwatch.session.id": "agent_scout" },
      }),
    ).toBe("agent_scout");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("reads a numeric session as text", () => {
    expect(
      readDeclaredSessionKey({
        attributes: {},
        resourceAttributes: { "langwatch.session.id": 42 },
      }),
    ).toBe("42");
  });

  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("is null when nothing is declared", () => {
    expect(
      readDeclaredSessionKey({ attributes: { "session.id": "s-1" }, resourceAttributes: null }),
    ).toBeNull();
  });
});
