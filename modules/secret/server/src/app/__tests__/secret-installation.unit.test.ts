import { createApp } from "@langwatch/runtime-composition";
import { SecretApi, SecretNotFoundError } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { secretServer } from "../../secret.server.ts";
import { ReversibleTestSecretEncryption } from "./secret.fixture.ts";

function process() {
  return createApp({ name: "secret-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withFeature(secretServer, {
      infrastructure: { encryption: new ReversibleTestSecretEncryption() },
    });
}

const input = { projectId: "project-1", name: "OPENAI_API_KEY", value: "sk-live" };
const caller = { id: "user-1" };

describe("secret app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(SecretApi);
      const created = await app.create(input, caller);

      expect(runtime.feature(secretServer).provided).toBe(app);

      await expect(app.get({ projectId: input.projectId, id: created.id })).resolves.toMatchObject({
        name: input.name,
      });

      await expect(
        app.get({ projectId: "other-project", id: created.id }),
      ).rejects.toBeInstanceOf(SecretNotFoundError);

      await app.delete({ projectId: input.projectId, id: created.id });

      await expect(app.get({ projectId: input.projectId, id: created.id })).rejects.toBeInstanceOf(
        SecretNotFoundError,
      );
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process().boot({ role: "api" });
    const second = await process().boot({ role: "api" });

    try {
      const created = await first.service(SecretApi).create(input, caller);

      await expect(
        second.service(SecretApi).get({ projectId: input.projectId, id: created.id }),
      ).rejects.toBeInstanceOf(SecretNotFoundError);

      await expect(
        first.service(SecretApi).list({ projectId: input.projectId }),
      ).resolves.toHaveLength(1);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  /** @scenario "Secret values never leave the boundary" */
  it("answers metadata that carries neither the value nor the ciphertext", async () => {
    const runtime = await process().boot({ role: "api" });

    try {
      const app = runtime.service(SecretApi);
      await app.create(input, caller);
      const [listed] = await app.list({ projectId: input.projectId });

      expect(listed).not.toHaveProperty("value");
      expect(listed).not.toHaveProperty("encryptedValue");
      await expect(app.getValues({ projectId: input.projectId })).resolves.toEqual({
        OPENAI_API_KEY: "sk-live",
      });
    } finally {
      await runtime.stop();
    }
  });
});
