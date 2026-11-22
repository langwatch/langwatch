import {
  CONNECTION_SUSPENDED_EVENT_TYPE,
  SUSPEND_CONNECTION_COMMAND_TYPE,
  type SsoConnectionCommand,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { SsoConnectionLedgerStore } from "../sso-connection-ledger.store.ts";

const ORGANIZATION = "org_1";

const suspend: SsoConnectionCommand = {
  type: SUSPEND_CONNECTION_COMMAND_TYPE,
  data: {
    tenantId: ORGANIZATION,
    organizationId: ORGANIZATION,
    connectionId: "conn_1",
    commandId: "cmd_1",
    occurredAtMs: 1,
    actor: { type: "user", id: "user_1" },
    source: "self-serve",
    reason: null,
  },
};

function ledger() {
  const send = vi.fn(async () => undefined);
  const store = SsoConnectionLedgerStore.create({
    // Not folded yet: the worker has not drained the command.
    projectionStore: {
      get: async () => ({ kind: "empty" }),
      store: async () => undefined,
    },
    stagedSender: async (name) => (name === "suspendConnection" ? { send } : null),
    convergence: { timeoutMs: 0, pollMs: 1 },
  });
  return { store, send };
}

describe("given a process that only produces sso connection commands", () => {
  describe("when a connection command states a fact", () => {
    /** @scenario "An SSO connection command commits on a process that only produces commands" */
    it("stages the command for the worker to append and answers its facts", async () => {
      const { store, send } = ledger();

      const facts = await store.commit({
        command: suspend,
        facts: [
          {
            type: CONNECTION_SUSPENDED_EVENT_TYPE,
            data: {
              connectionId: "conn_1",
              reason: null,
              actor: { type: "user", id: "user_1" },
              source: "self-serve",
            },
          },
        ],
      });

      expect(send).toHaveBeenCalledExactlyOnceWith(suspend.data);
      expect(facts.map((fact) => fact.type)).toEqual([CONNECTION_SUSPENDED_EVENT_TYPE]);
    });
  });
});
