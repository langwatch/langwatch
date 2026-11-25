// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Mounting the sign-in providers records sso's fact; licensing answers the gate status from it.
 * Spec: enterprise/modules/sso/specs/sso.feature
 */
import type { EventingCommands } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { SsoSignInProviderPipeline } from "../../eventing/sso-sign-in-provider.pipeline.ts";
import { createSsoTestApp, createSsoTestConfig } from "./sso.fixture.ts";

type Senders = EventingCommands<SsoSignInProviderPipeline>;

const BETTER_AUTH_URL = "https://app.langwatch.test";

describe("getSignInProviderMounts records the sign-in provider fact", () => {
  describe("given a deployment configured with a federation provider", () => {
    /** @scenario "Mounting the sign-in providers records which provider mounted" */
    it("records the provider and whether it mounted on the deployment's aggregate", async () => {
      const sent: Record<string, unknown>[] = [];
      const app = await createSsoTestApp({
        config: createSsoTestConfig({ authProvider: "okta" }),
      });
      app.connectSignInProviderCommands(
        createApiFixture<Senders>({
          recordSignInProvider: createApiFixture<Senders["recordSignInProvider"]>({
            send: async (payload) => void sent.push(payload),
          }),
        }),
      );

      await app.getSignInProviderMounts({ baseUrl: BETTER_AUTH_URL });

      expect(sent).toEqual([
        expect.objectContaining({ tenantId: "__global__", provider: "okta", mounted: false }),
      ]);
    });
  });

  describe("given the fact cannot be sent", () => {
    /** @scenario "A fact that cannot be sent never stops sign-in mounting" */
    it("still answers the providers", async () => {
      const app = await createSsoTestApp({ config: createSsoTestConfig() });
      app.connectSignInProviderCommands(
        createApiFixture<Senders>({
          recordSignInProvider: createApiFixture<Senders["recordSignInProvider"]>({
            send: async () => {
              throw new Error("queue unavailable");
            },
          }),
        }),
      );

      const mounts = await app.getSignInProviderMounts({ baseUrl: BETTER_AUTH_URL });

      expect(mounts.genericOAuthConfigs.map((config) => config.providerId)).toEqual(["auth0"]);
    });
  });
});
