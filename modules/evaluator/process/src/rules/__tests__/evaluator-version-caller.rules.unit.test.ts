/**
 * Spec: modules/evaluator/specs/evaluator-versioning.feature
 */
import { internalActor } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { evaluatorCallerOf } from "../evaluator-version-caller.rules.ts";

describe("evaluatorCallerOf", () => {
  /** @scenario "An unattributed credential cannot bypass the deploy check" */
  it("keeps a named system actor and fails an internal proof actor closed", () => {
    expect(evaluatorCallerOf({ actor: { type: "system", name: "managementApi" } })).toEqual({
      type: "system",
    });
    expect(evaluatorCallerOf({ actor: internalActor("rest.ownerless-project-key") })).toEqual({
      type: "unattributed",
    });
    expect(
      evaluatorCallerOf({
        actor: internalActor("rest.ownerless-project-key"),
        key: { apiKeyId: "key_1" },
      }),
    ).toEqual({ type: "api_key", id: "key_1" });
  });
});
