import { managedProviderSecrets } from "@langwatch/enterprise-managed-provider-contract";
import { ResourceScope } from "@langwatch/kernel";
import { SecretsChain, SecretsResolver, type ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { ManagedProviderApp } from "../managed-provider.app.ts";

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

/** Scopes a real secrets chain the same way boot would, over one environment. */
function secretsFrom(environment: Record<string, string | undefined>): ScopedSecrets {
  const chain = SecretsChain.start({ environment }).withEnv();
  return SecretsResolver.over(chain).scopeTo(
    "managed-provider",
    Object.values(managedProviderSecrets),
  );
}

function install(environment: Record<string, string | undefined>) {
  return ManagedProviderApp.create({
    config: void 0,
    resources: new ResourceScope(),
    secrets: secretsFrom(environment),
    dependencies: { projects: peer("project") },
  });
}

describe("managed provider installation", () => {
  describe("given a process configured with a managed Bedrock directory", () => {
    /** @scenario "A configured process serves managed Bedrock" */
    it("installs and resolves an organization in that directory", async () => {
      const app = await install({
        MANAGED_BEDROCK_CONFIGS: JSON.stringify({ org_1: DEPLOYMENT }),
      });

      expect(app.isManagedProvider({ organizationId: "org_1", provider: "bedrock" })).toBe(true);
      expect(app.isManagedProvider({ organizationId: "org_2", provider: "bedrock" })).toBe(false);
    });
  });

  describe("given a process that configured no managed Bedrock directory", () => {
    /** @scenario "Run without managed Bedrock when none is configured" */
    it("installs anyway and manages nothing", async () => {
      const app = await install({});

      expect(app.isManagedProvider({ organizationId: "org_1", provider: "bedrock" })).toBe(false);
    });
  });
});
