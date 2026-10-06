import { createApp, ResourceScope } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretApi, SecretNotFoundError } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { secretProcessModule } from "../../secret.module.ts";
import { teamWithMembers } from "./secret.fixture.ts";

function process(role: "api" | "worker") {
  const team = teamWithMembers(["user-first"]);

  return createApp({ role })
    .withModules([secretProcessModule])
    .withStores(memoryStores())
    .provide({ authz: team.permissions });
}

const input = { projectId: "project-1", name: "OPENAI_API_KEY", value: "sk-live" };
const caller = { id: "user-1" };

describe("secret app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(SecretApi);
      const created = await app.create(input, caller);

      expect(runtime.module(secretProcessModule).provided).toBe(app);

      await expect(app.get({ projectId: input.projectId, id: created.id })).resolves.toMatchObject({
        name: input.name,
      });

      await expect(app.get({ projectId: "other-project", id: created.id })).rejects.toBeInstanceOf(
        SecretNotFoundError,
      );

      await app.delete({ projectId: input.projectId, id: created.id });

      await expect(app.get({ projectId: input.projectId, id: created.id })).rejects.toBeInstanceOf(
        SecretNotFoundError,
      );
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

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

  /** @scenario "A process with no key composes no secret service" */
  it("refuses at boot, naming the missing encryption, when the process has no key", async () => {
    const resources = new ResourceScope();

    await expect(
      secretProcessModule.install({
        resources,
        config: undefined,
        members: {},
        repositorySelection: {
          tier: "live",
          members: { prisma: prismaDouble(), redis: redisDouble() },
        },
        role: "api",
        secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
        resolve: () => teamWithMembers(["user-first"]).permissions,
      }),
    ).rejects.toThrow(/encryption/i);
    await resources.close();
  });

  /** @scenario "The first read returns the secret and the second refuses" */
  it("serves a one-time reveal through the installed app, once", async () => {
    const runtime = await process("api").boot();

    try {
      const app = runtime.service(SecretApi);
      const { revealId } = await app.stashReveal({
        organizationId: "org_acme",
        kind: "virtual_key",
        keyId: "vk_1",
        preview: "sk-\u20264f2a",
        secret: "sk-live-9f2c",
      });

      await expect(app.revealOnce({ organizationId: "org_acme", revealId })).resolves.toMatchObject(
        { secret: "sk-live-9f2c" },
      );
      await expect(app.revealOnce({ organizationId: "org_acme", revealId })).rejects.toMatchObject({
        code: "secret_already_revealed",
      });
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Secret values never leave the boundary" */
  it("answers metadata that carries neither the value nor the ciphertext", async () => {
    const runtime = await process("api").boot();

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
