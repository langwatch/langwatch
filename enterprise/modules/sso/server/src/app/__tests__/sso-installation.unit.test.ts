/**
 * @vitest-environment node
 */
import { SsoApi } from "@langwatch/enterprise-sso-contract";
import { createApp } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import { ssoServer } from "../../sso.server.ts";
import {
  createSsoTestAuditLog,
  createSsoTestConfiguration,
  createSsoTestLicensing,
  createSsoTestOperators,
  createSsoTestUsers,
  RecordingSsoConnectionLedger,
  RecordingSsoGateLogger,
  SSO_TEST_STAFF_EMAIL,
} from "./sso.fixture.ts";

const STAFF_ID = "user_olive";

function process(
  options: {
    connections?: RecordingSsoConnectionLedger;
    configuration?: ReturnType<typeof createSsoTestConfiguration>;
  } = {},
) {
  return createApp({ role: "api" })
    .withModules([ssoServer])
    .withConfig({ sso: options.configuration ?? createSsoTestConfiguration() })
    .withMember("connections", options.connections ?? RecordingSsoConnectionLedger.create())
    .withObservability((observability) =>
      observability.withLogging(RecordingSsoGateLogger.create()),
    )
    .provide({
      licensing: createSsoTestLicensing(),
      ops: createSsoTestOperators(),
      user: createSsoTestUsers({ [STAFF_ID]: SSO_TEST_STAFF_EMAIL }),
      "audit-log": createSsoTestAuditLog(),
    });
}

describe("given a process that installed single sign-on", () => {
  describe("when the api role boots it", () => {
    it("serves the feature api the back office reads", async () => {
      const connections = RecordingSsoConnectionLedger.create();
      const runtime = await process({ connections }).boot();

      try {
        const app = runtime.service(SsoApi);
        expect(runtime.module(ssoServer).provided).toBe(app);

        await expect(
          app.listConnections({ page: 0, pageSize: 25 }, { id: STAFF_ID }),
        ).resolves.toEqual({ connections: [], total: 0 });
        expect(connections.list).toHaveBeenCalledOnce();
      } finally {
        await runtime.stop();
      }
    });

    it("falls back to email when the configured provider has no credentials", async () => {
      const runtime = await process({
        configuration: createSsoTestConfiguration({ auth0ClientSecret: undefined }),
      }).boot();

      try {
        const app = runtime.service(SsoApi);
        expect(app.providerIsMounted()).toBe(false);
        await expect(app.resolveProvider()).resolves.toBe("email");
      } finally {
        await runtime.stop();
      }
    });
  });
});
