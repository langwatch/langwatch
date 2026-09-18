import {
  ManagedProviderApi,
  type ManagedProviderAppConfig,
} from "@langwatch/enterprise-managed-provider-contract";
import { createApp } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import { managedProviderServer } from "../../managed-provider.server.ts";

/** A peer the boot resolves and no assertion here calls. */
function peer(name: string): never {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        throw new Error(`The ${name} peer was called for "${String(property)}".`);
      },
    },
  ) as never;
}

const DEPLOYMENT = {
  proxyRoleArn: "proxy",
  bedrockRoleArn: "customer",
  proxyAwsAccessKeyId: "key",
  proxyAwsSecretAccessKey: "secret",
  bedrockProxyEndpoint: "private.internal",
  region: "eu-west-1",
};

function install(config: ManagedProviderAppConfig) {
  return createApp({ role: "worker" })
    .withModules([managedProviderServer])
    .withConfig({ "managed-provider": config })
    .provide({ project: peer("project") });
}

describe("managed provider installation", () => {
  describe("given a process configured with a managed Bedrock directory", () => {
    /** @scenario "A configured process serves managed Bedrock" */
    it("installs and resolves an organization in that directory", async () => {
      const runtime = await install({
        bedrock: { org_1: DEPLOYMENT },
      }).boot();

      try {
        const app = runtime.service(ManagedProviderApi);

        expect(app.isManagedProvider({ organizationId: "org_1", provider: "bedrock" })).toBe(true);
        expect(app.isManagedProvider({ organizationId: "org_2", provider: "bedrock" })).toBe(false);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given a process that configured no managed Bedrock directory", () => {
    /** @scenario "Run without managed Bedrock when none is configured" */
    it("installs anyway and manages nothing", async () => {
      const runtime = await install({ bedrock: {} }).boot();

      try {
        expect(
          runtime
            .service(ManagedProviderApi)
            .isManagedProvider({ organizationId: "org_1", provider: "bedrock" }),
        ).toBe(false);
      } finally {
        await runtime.stop();
      }
    });
  });
});
