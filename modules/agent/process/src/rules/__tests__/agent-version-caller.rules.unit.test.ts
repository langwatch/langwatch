/**
 * Spec: modules/agent/specs/agent-versioning.feature
 */
import { internalActor } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { agentCallerOf } from "../agent-version-caller.rules.ts";

describe("agentCallerOf", () => {
  /** @scenario "An unattributed credential cannot bypass the deploy check" */
  it("keeps a named system actor and fails an internal proof actor closed", () => {
    expect(agentCallerOf({ actor: { type: "system", name: "managementApi" } })).toEqual({
      type: "system",
    });
    expect(agentCallerOf({ actor: internalActor("rest.ownerless-project-key") })).toEqual({
      type: "unattributed",
    });
    expect(
      agentCallerOf({
        actor: internalActor("rest.ownerless-project-key"),
        key: { apiKeyId: "key_1" },
      }),
    ).toEqual({ type: "api_key", id: "key_1" });
  });
});
