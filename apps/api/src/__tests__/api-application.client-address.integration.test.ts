/**
 * The caller's address on the tRPC surface.
 * @regression
 */
import { SecretService, type Secret } from "@langwatch/secret-contract";
import { AgentService } from "@langwatch/agent-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiApplication, MissingAgentService, NoApiTrpcFeatures } from "../api.application";
import { ApiHttpListener } from "../api-http.listener";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

class TestSecretService extends SecretService {
  readonly list = vi.fn(async () => [secret]);
  readonly getValues = vi.fn(async () => ({}));
  readonly get = vi.fn(async () => secret);
  readonly create = vi.fn(async () => secret);
  readonly update = vi.fn(async () => secret);
  readonly delete = vi.fn(async () => undefined);
}

/** One public procedure that answers with the key the limits would use. */
class AddressProbeFeatures extends NoApiTrpcFeatures {
  override build(mount: {
    root: { router: (record: Record<string, unknown>) => unknown };
    publicProcedure: { query: (resolve: (options: { ctx: unknown }) => string) => unknown };
  }) {
    return {
      probe: mount.root.router({
        address: mount.publicProcedure.query(({ ctx }) =>
          (ctx as { clientIp(): string }).clientIp(),
        ),
      }),
    } as never;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

async function probeAddress(headers: Record<string, string>): Promise<string> {
  const application = ApiApplication.create({
    features: new AddressProbeFeatures(),
    agents: new MissingAgentService() as AgentService,
    secrets: new TestSecretService(),
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
      }),
    },
  });
  if (!application.hono) throw new Error("HTTP composition was not created.");

  const listener = ApiHttpListener.create({
    application: application.hono,
    host: "127.0.0.1",
    port: 0,
  });
  const address = await listener.start();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/trpc/probe.address`, {
      headers,
    });
    const body = (await response.json()) as { result?: { data?: { json?: string } } };
    const resolved = body.result?.data?.json;
    if (typeof resolved !== "string") throw new Error(`No address in ${JSON.stringify(body)}`);
    return resolved;
  } finally {
    await listener.close();
  }
}

describe("the tRPC surface's per-caller rate-limit key", () => {
  /** @scenario "A caller whose address cannot be resolved gets its own bucket" */
  describe("when a call is resolved with no transport to read an address from", () => {
    it("names the unresolved bucket rather than a resolved caller's key", async () => {
      const application = ApiApplication.create({
        features: new AddressProbeFeatures(),
        agents: new MissingAgentService() as AgentService,
        secrets: new TestSecretService(),
        http: {
          createContext: async () => ({
            actor: () => ({ id: "user-1" }),
            authorize: async () => undefined,
          }),
        },
      });

      const caller = application.createCaller({
        actor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
      }) as unknown as { probe: { address: () => Promise<string> } };

      await expect(caller.probe.address()).resolves.toBe("unresolved");
    });
  });

  /** @scenario "The signed-out tRPC surface keys on the resolved address" */
  describe("when a caller supplies a forwarding header from an untrusted peer", () => {
    it("keys on the socket address rather than on the constant every caller shared", async () => {
      const resolved = await probeAddress({ "cf-connecting-ip": "203.0.113.7" });

      expect(resolved).toBe("127.0.0.1");
      expect(resolved).not.toBe("unknown");
    });
  });

  describe("when the deployment names the peer as a trusted proxy", () => {
    it("reads the chain that proxy forwarded", async () => {
      vi.stubEnv("TRUSTED_PROXY_ADDRESSES", "127.0.0.1");

      await expect(probeAddress({ "x-forwarded-for": "203.0.113.7, 127.0.0.1" })).resolves.toBe(
        "203.0.113.7",
      );
    });
  });
});
