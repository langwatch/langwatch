/** Spec: specs/identity/sso-idp-termination.feature */
import { describe, expect, it } from "vitest";

import type { SsoConnectionRegistrationSlot } from "../../repositories/sso-connection-registration.repository.ts";
import { findBlockingRegistrationSlots } from "../sso-connection-registration.rules.ts";

const ORG = "org_acme";

function slot(overrides: Partial<SsoConnectionRegistrationSlot>): SsoConnectionRegistrationSlot {
  return {
    organizationId: ORG,
    kind: "direct",
    connectionId: "ssoc_direct",
    replacesConnectionId: null,
    commandId: "cmd_1",
    ...overrides,
  };
}

const legacy = slot({ kind: "legacy", connectionId: "ssoc_legacy" });

describe("findBlockingRegistrationSlots", () => {
  it.each([
    {
      name: "admits the first direct connection",
      slots: [],
      states: {},
      candidate: slot({}),
      blocked: [],
    },
    {
      name: "admits a retry of the connection already holding the slot",
      slots: [slot({})],
      states: { ssoc_direct: "DRAFT" },
      candidate: slot({}),
      blocked: [],
    },
    {
      name: "refuses a second direct connection while the first stands",
      slots: [slot({})],
      states: { ssoc_direct: "ACTIVE" },
      candidate: slot({ connectionId: "ssoc_other" }),
      blocked: ["ssoc_direct"],
    },
    {
      name: "counts a slot whose connection row is not written yet as held",
      slots: [slot({})],
      states: {},
      candidate: slot({ connectionId: "ssoc_other" }),
      blocked: ["ssoc_direct"],
    },
    {
      name: "frees the slot of a discarded connection",
      slots: [slot({})],
      states: { ssoc_direct: "DISCARDED" },
      candidate: slot({ connectionId: "ssoc_other" }),
      blocked: [],
    },
    {
      name: "admits the exact replacement beside the legacy connection it names",
      slots: [legacy],
      states: { ssoc_legacy: "ACTIVE" },
      candidate: slot({ replacesConnectionId: "ssoc_legacy" }),
      blocked: [],
    },
    {
      name: "refuses a direct connection beside legacy that replaces nothing",
      slots: [legacy],
      states: { ssoc_legacy: "ACTIVE" },
      candidate: slot({}),
      blocked: ["ssoc_legacy"],
    },
  ])("$name", ({ slots, states, candidate, blocked }) => {
    const held = findBlockingRegistrationSlots({
      candidate,
      slots,
      stateByConnection: new Map<string, string>(Object.entries(states)),
    });

    expect(held.map((blocking) => blocking.connectionId)).toEqual(blocked);
  });
});
