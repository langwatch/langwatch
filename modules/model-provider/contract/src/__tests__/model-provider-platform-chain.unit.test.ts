import { describe, expect, it } from "vitest";

import {
  platformProviderChainOf,
  platformProviderCredentialNames,
} from "../model-provider-platform-chain.ts";

describe("the platform's own provider chain", () => {
  it("names each dispatchable provider's credential from the registry", () => {
    const names = platformProviderCredentialNames();

    expect(names).toContainEqual({ provider: "openai", credentialKey: "OPENAI_API_KEY" });
    expect(names).toContainEqual({ provider: "anthropic", credentialKey: "ANTHROPIC_API_KEY" });
  });

  it("offers only the providers this deployment resolved a credential for", () => {
    const chain = platformProviderChainOf({ openai: "sk-platform", anthropic: undefined });

    expect(chain).toEqual([
      { provider: "openai", credentialKey: "OPENAI_API_KEY", credential: "sk-platform" },
    ]);
  });

  it("reads a blank credential as none, so the chain never offers one that cannot authenticate", () => {
    expect(platformProviderChainOf({ openai: "   " })).toEqual([]);
  });

  it("orders the chain by the registry rather than by the credentials it was handed", () => {
    const chain = platformProviderChainOf({ anthropic: "sk-a", openai: "sk-o" });
    const registryOrder = platformProviderCredentialNames().map(({ provider }) => provider);

    expect(chain.map((entry) => entry.provider)).toEqual(
      registryOrder.filter((provider) => provider === "openai" || provider === "anthropic"),
    );
  });

  it("is empty for a deployment that holds no keys of its own", () => {
    expect(platformProviderChainOf({})).toEqual([]);
  });
});
