/**
 * Managed models on the install's side and on LangWatch Cloud's.
 *
 * The install: the LangWatch provider slot is added only where an operator
 * switched Connect on for the deployment and an admin switched the service on
 * for the organization, and the license token reaches it without ever being
 * written to a provider row.
 *
 * LangWatch Cloud: the chain a license's managed key dispatches to is the
 * platform's own environment keys, and only while the license is entitled.
 *
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 */

import type { ConnectConfig } from "@ee/licensing/connect/install/connectConfig";
import type { ConnectCredential } from "@ee/licensing/connect/install/connectTransport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

const config = vi.hoisted(() => ({
  current: { enabled: false } as ConnectConfig,
}));
const credential = vi.hoisted(() => ({
  current: null as ConnectCredential | null,
}));

vi.mock("@ee/licensing/connect/install/connectConfig", () => ({
  readConnectConfig: () => config.current,
}));
vi.mock("@ee/licensing/connect/install/connectCredential", () => ({
  resolveConnectCredential: async () => credential.current,
}));

const { connectLangWatchProviderSlot, platformSharedModelProviders } =
  await import("../connectManagedModels");
const { computeConfigETag } = await import("../configETag");

const CONNECT_ON: ConnectConfig = {
  enabled: true,
  gatewayEndpoint: "https://gateway.langwatch.ai",
  licenseEndpoint: "https://connect.langwatch.ai",
};
const LICENSE_TOKEN = `lwl_${"a".repeat(64)}`;

function prismaWithServices(connectServices: string[]): PrismaClient {
  return {
    organization: {
      findUnique: async () => ({ connectServices }),
    },
    modelProvider: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

describe("the LangWatch provider slot an install adds", () => {
  beforeEach(() => {
    config.current = CONNECT_ON;
    credential.current = {
      token: LICENSE_TOKEN,
      instanceId: "org-install-1",
    };
  });

  describe("given Connect is on and the organization switched managed models on", () => {
    /** @scenario The install adds the LangWatch provider only when Connect and the service are on */
    it("carries the license token, the instance id and the gateway endpoint", async () => {
      const slot = await connectLangWatchProviderSlot({
        prisma: prismaWithServices(["instant_evals", "managed_models"]),
        organizationId: "org-1",
        slot: "fallback_2",
      });

      expect(slot).toEqual({
        id: "connect-langwatch",
        slot: "fallback_2",
        type: "langwatch",
        credentials: {
          api_key: LICENSE_TOKEN,
          instance_id: "org-install-1",
        },
        base_url: "https://gateway.langwatch.ai/v1",
        models: [],
        config: {},
      });
    });
  });

  describe("when Connect is off for the deployment", () => {
    it("adds nothing, whatever the organization switched on", async () => {
      config.current = { enabled: false };

      expect(
        await connectLangWatchProviderSlot({
          prisma: prismaWithServices(["managed_models"]),
          organizationId: "org-1",
          slot: "fallback_0",
        }),
      ).toBeNull();
    });
  });

  describe("when the organization has not switched managed models on", () => {
    it("adds nothing", async () => {
      expect(
        await connectLangWatchProviderSlot({
          prisma: prismaWithServices(["instant_evals"]),
          organizationId: "org-1",
          slot: "fallback_0",
        }),
      ).toBeNull();
    });
  });

  describe("when the organization holds no license", () => {
    it("adds nothing, because there is no credential to present", async () => {
      credential.current = null;

      expect(
        await connectLangWatchProviderSlot({
          prisma: prismaWithServices(["managed_models"]),
          organizationId: "org-1",
          slot: "fallback_0",
        }),
      ).toBeNull();
    });
  });
});

describe("the version token of a key's configuration", () => {
  beforeEach(() => {
    config.current = CONNECT_ON;
    credential.current = {
      token: LICENSE_TOKEN,
      instanceId: "org-install-1",
    };
  });

  // The slot is synthesized rather than read from a row, so the provider
  // digest never sees it. Without it in the token an admin switching the
  // service on would leave every gateway revalidating against a bundle that
  // has no such provider.
  it("moves when the organization switches managed models on", async () => {
    const virtualKey = {
      id: "vk-1",
      organizationId: "org-1",
      revision: 3n,
      purpose: "GENERIC",
      routingPolicyId: null,
      scopes: [],
    } as unknown as Parameters<typeof computeConfigETag>[0]["virtualKey"];

    const off = await computeConfigETag({
      prisma: prismaWithServices([]),
      virtualKey,
    });
    const on = await computeConfigETag({
      prisma: prismaWithServices(["managed_models"]),
      virtualKey,
    });

    expect(on).not.toBe(off);
  });
});

describe("the platform providers a license's managed key dispatches to", () => {
  const previous: Record<string, string | undefined> = {};
  const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY"];

  beforeEach(() => {
    for (const name of keys) {
      previous[name] = process.env[name];
      delete process.env[name];
    }
    process.env.OPENAI_API_KEY = "sk-platform-openai";
    process.env.ANTHROPIC_API_KEY = "sk-platform-anthropic";
  });

  afterEach(() => {
    for (const name of keys) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });

  it("names the providers the environment holds a key for, and no others", () => {
    const providers = platformSharedModelProviders("org-customer-1");

    const byProvider = providers.map((mp) => mp.provider);
    expect(byProvider).toContain("openai");
    expect(byProvider).toContain("anthropic");
    expect(byProvider).not.toContain("groq");
  });

  it("carries the environment key as the row's credential bag", () => {
    const openai = platformSharedModelProviders("org-customer-1").find(
      (mp) => mp.provider === "openai",
    );

    expect(openai?.customKeys).toEqual({
      OPENAI_API_KEY: "sk-platform-openai",
    });
    expect(openai?.organizationId).toBe("org-customer-1");
    expect(openai?.enabled).toBe(true);
  });
});
