import { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import { managedProviderServer } from "../../managed-provider.server.ts";

/**
 * The module reads no process member, so a process that opened no client at all
 * must still install it. Reading any member here is the failure.
 */
function membersWithoutStores() {
  return {
    order: [] as const,
    read(name: string): unknown {
      throw new Error(`Installing managed-provider must not read the "${name}" member.`);
    },
    async close() {},
  };
}

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

function install(config: Readonly<Record<string, unknown>>) {
  return createApp({ role: "worker", config, members: membersWithoutStores() as never })
    .withProvided(ProjectApi, peer("project"))
    .withModules([managedProviderServer]);
}

describe("managed provider installation", () => {
  describe("given a process configured with a managed Bedrock directory", () => {
    /** @scenario "A configured process serves managed Bedrock" */
    it("installs and resolves an organization in that directory", async () => {
      const runtime = await install({
        "managed-provider": { bedrock: { org_1: DEPLOYMENT } },
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
      const runtime = await install({}).boot();

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
