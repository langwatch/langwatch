/**
 * @vitest-environment node
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { SsoApi } from "@langwatch/enterprise-sso-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
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

function process(connections = RecordingSsoConnectionLedger.create()) {
  return createApp({ name: "sso-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(LicensingApi, createSsoTestLicensing())
    .withProvided(OpsApi, createSsoTestOperators())
    .withProvided(UserApi, createSsoTestUsers({ [STAFF_ID]: SSO_TEST_STAFF_EMAIL }))
    .withProvided(AuditLogApi, createSsoTestAuditLog())
    .withModule(ssoServer, {
      members: { connections, logger: RecordingSsoGateLogger.create() },
    });
}

describe("given a process that installed single sign-on", () => {
  describe("when the api role boots it", () => {
    it("serves the feature api the back office reads", async () => {
      const connections = RecordingSsoConnectionLedger.create();
      const runtime = await process(connections).boot({
        role: "api",
        config: { sso: createSsoTestConfiguration() },
      });

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
      const runtime = await process().boot({
        role: "api",
        config: {
          sso: createSsoTestConfiguration({ auth0ClientSecret: undefined }),
        },
      });

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
