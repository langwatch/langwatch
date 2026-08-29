import { SecretService, type Secret } from "@langwatch/secret-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../api.application";
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
  readonly list = vi.fn(async ({ projectId }: { projectId: string }) => [{ ...secret, projectId }]);
  readonly getValues = vi.fn(async () => ({}));
  readonly get = vi.fn(async () => secret);
  readonly create = vi.fn(async () => secret);
  readonly update = vi.fn(async () => secret);
  readonly delete = vi.fn(async () => undefined);
}

describe("ApiApplication HTTP transport", () => {
  it("serves a mixed tRPC batch through the standalone listener and one composed service", async () => {
    const secrets = new TestSecretService();
    const application = ApiApplication.create({
      secrets,
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
      const input = encodeURIComponent(
        JSON.stringify({
          0: { json: { projectId: "project-1" } },
          1: { json: { projectId: "project-2" } },
        }),
      );
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/trpc/secrets.list,secrets.list?batch=1&input=${input}`,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
        { result: { data: { json: [{ projectId: "project-1", name: "MY_SECRET" }] } } },
        { result: { data: { json: [{ projectId: "project-2", name: "MY_SECRET" }] } } },
      ]);
      expect(secrets.list).toHaveBeenNthCalledWith(1, { projectId: "project-1" });
      expect(secrets.list).toHaveBeenNthCalledWith(2, { projectId: "project-2" });
    } finally {
      await listener.close();
    }
  });
});
