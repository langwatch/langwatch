/**
 * @vitest-environment node
 * `SsoApp.create` directly: `createApp().boot()`'s test harness has no
 * `ModuleSecretsScope` yet, so a module resolving a declared handle cannot
 * boot through it. `managed-provider` and `scim` test the same way.
 */
import { describe, expect, it } from "vitest";

import {
  createSsoTestApp,
  createSsoTestConfig,
  createSsoTestUsers,
  RecordingSsoConnectionLedger,
  SSO_TEST_STAFF_EMAIL,
} from "./sso.fixture.ts";

const STAFF_ID = "user_olive";

describe("given a process that installed single sign-on", () => {
  describe("when the app is constructed", () => {
    /** @scenario "A configured process serves the back office's connection ledger" */
    it("serves the feature api the back office reads", async () => {
      const connections = RecordingSsoConnectionLedger.create();
      const app = await createSsoTestApp({
        connections,
        dependencies: { users: createSsoTestUsers({ [STAFF_ID]: SSO_TEST_STAFF_EMAIL }) },
      });

      await expect(
        app.listConnections({ page: 0, pageSize: 25 }, { id: STAFF_ID }),
      ).resolves.toEqual({ connections: [], total: 0 });
      expect(connections.list).toHaveBeenCalledOnce();
    });

    /** @scenario "A provider without credentials falls back to email" */
    it("falls back to email when the configured provider has no credentials", async () => {
      const app = await createSsoTestApp({
        config: createSsoTestConfig(),
        secrets: { auth0ClientSecret: undefined },
      });

      expect(app.providerIsMounted()).toBe(false);
      await expect(app.resolveProvider()).resolves.toBe("email");
    });
  });
});
