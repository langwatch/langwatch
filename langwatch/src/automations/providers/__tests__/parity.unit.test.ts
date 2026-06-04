import { TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { CLIENT_PROVIDERS, NOTIFY_PROVIDERS, ACTION_PROVIDERS } from "../client";
import { SERVER_PROVIDERS } from "../server";

/**
 * The provider system enforces two invariants here. Failures mean the
 * registries have drifted from the `TriggerAction` enum or each other —
 * which would silently break the drawer or the server dispatcher when a
 * new action type lands. Keep this test passing.
 */
describe("provider registry parity", () => {
  it("every TriggerAction has a client registration", () => {
    for (const action of Object.values(TriggerAction)) {
      expect(CLIENT_PROVIDERS[action]).toBeDefined();
      expect(CLIENT_PROVIDERS[action].shared.action).toBe(action);
    }
  });

  it("every TriggerAction has a server registration", () => {
    for (const action of Object.values(TriggerAction)) {
      expect(SERVER_PROVIDERS[action]).toBeDefined();
      expect(SERVER_PROVIDERS[action].shared.action).toBe(action);
    }
  });

  it("client + server share the same shared definition per action", () => {
    for (const action of Object.values(TriggerAction)) {
      expect(CLIENT_PROVIDERS[action].shared).toBe(SERVER_PROVIDERS[action].shared);
    }
  });

  it("notify and action categories partition the enum", () => {
    const notifyActions = NOTIFY_PROVIDERS.map((p) => p.shared.action);
    const actionActions = ACTION_PROVIDERS.map((p) => p.shared.action);
    expect(new Set([...notifyActions, ...actionActions])).toEqual(
      new Set(Object.values(TriggerAction)),
    );
    expect(notifyActions.some((a) => actionActions.includes(a))).toBe(false);
  });

  it("notify providers carry a channel string the preview/testFire endpoints accept", () => {
    for (const p of NOTIFY_PROVIDERS) {
      expect(["email", "slack"]).toContain(p.client.channel);
    }
  });

  it("every provider exposes a config form, an icon, and the slice helpers", () => {
    for (const action of Object.values(TriggerAction)) {
      const p = CLIENT_PROVIDERS[action];
      expect(p.client.Icon).toBeDefined();
      expect(p.client.ConfigForm).toBeDefined();
      expect(typeof p.client.initialSlice).toBe("function");
      expect(typeof p.client.isComplete).toBe("function");
      expect(typeof p.client.summary).toBe("function");
      expect(typeof p.client.fromTriggerRow).toBe("function");
      expect(typeof p.client.toActionParams).toBe("function");
    }
  });
});
