import { describe, expect, it, vi } from "vitest";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
  AuthzLedgerUnavailableError,
} from "../../src/adapters/eventing.authz-ledger.adapter";
import {
  ACTOR,
  ORG_ID,
  binding,
  harness,
} from "../support/eventing.authz-ledger-fork.harness";

class RecoveringDispatcher extends AuthzGrantsCommandDispatcher {
  readonly commandsCall = vi.fn();
  readonly send = vi.fn().mockResolvedValue(undefined);
  private available = false;

  recover(): void {
    this.available = true;
  }

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    this.commandsCall();
    if (!this.available) throw new AuthzLedgerUnavailableError();
    return {
      commands: new Proxy({} as AuthzGrantsCommandSenders, {
        get: () => ({ send: this.send }),
      }),
    };
  }
}

describe("EventingAuthzLedgerAdapter unavailable dispatcher", () => {
  /** @scenario "Attaching a grant while the queue is unavailable fails loudly" */
  it("does not half-write and allows a later retry", async () => {
    const dispatcher = new RecoveringDispatcher();
    const { writer, db } = harness({ onLedger: true, dispatcher });
    const input = {
      organizationId: ORG_ID,
      bindings: [binding],
      actor: ACTOR,
      onDuplicate: "reject" as const,
    };

    await expect(writer.attachBindings(input)).rejects.toMatchObject({
      code: "authz_ledger_unavailable",
    });
    expect(dispatcher.send).not.toHaveBeenCalled();
    expect(db.roleBinding.create).not.toHaveBeenCalled();

    dispatcher.recover();
    await expect(writer.attachBindings(input)).resolves.toEqual({
      attached: [binding.bindingId],
      duplicates: [],
    });
    expect(dispatcher.commandsCall).toHaveBeenCalledTimes(2);
    expect(dispatcher.send).toHaveBeenCalledTimes(1);
  });
});
