import { SecretNotFoundError, SecretService, type Secret } from "@langwatch/secret-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../api.application";

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

function createCaller(service: TestSecretService) {
  const actor = vi.fn(() => ({ id: "user-1" }));
  const authorize = vi.fn(async () => undefined);
  const app = ApiApplication.create({ secrets: service });
  return { actor, authorize, secrets: secretRouterOf(app.createCaller({ actor, authorize })) };
}

/**
 * The secret router, or a failed test.
 *
 * The root composes the router only for a process that was given a secret
 * service, so its type is optional at every caller. Narrowing here says which
 * of the two shapes each scenario below is about.
 */
function secretRouterOf<Caller extends { secrets?: unknown }>(
  caller: Caller,
): NonNullable<Caller["secrets"]> {
  const secrets = caller.secrets;
  if (!secrets) throw new Error("Secret router was not composed.");
  return secrets as NonNullable<Caller["secrets"]>;
}

describe("ApiApplication Secret tRPC composition", () => {
  it("composes the fragment and preserves list and create shapes", async () => {
    const service = new TestSecretService();
    const { actor, authorize, secrets } = createCaller(service);

    await expect(secrets.list({ projectId: "project-1" })).resolves.toEqual([secret]);
    await expect(
      secrets.create({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "secret-value",
      }),
    ).resolves.toEqual(secret);

    expect(authorize).toHaveBeenNthCalledWith(1, "secrets:view", { projectId: "project-1" });
    expect(authorize).toHaveBeenNthCalledWith(2, "secrets:manage", { projectId: "project-1" });
    expect(service.list).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(service.create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "MY_SECRET",
      value: "secret-value",
      actorId: "user-1",
    });
    expect(actor).toHaveBeenCalledTimes(4);
  });

  it("preserves legacy update and delete inputs and success responses", async () => {
    const service = new TestSecretService();
    const { authorize, secrets } = createCaller(service);

    await expect(
      secrets.update({
        projectId: "project-1",
        secretId: "secret-1",
        value: "rotated-value",
      }),
    ).resolves.toEqual({ success: true });
    await expect(secrets.delete({ projectId: "project-1", secretId: "secret-1" })).resolves.toEqual(
      {
        success: true,
      },
    );

    expect(authorize).toHaveBeenNthCalledWith(1, "secrets:manage", { projectId: "project-1" });
    expect(authorize).toHaveBeenNthCalledWith(2, "secrets:manage", { projectId: "project-1" });
    expect(service.update).toHaveBeenCalledWith({
      projectId: "project-1",
      id: "secret-1",
      value: "rotated-value",
      actorId: "user-1",
    });
    expect(service.delete).toHaveBeenCalledWith({ projectId: "project-1", id: "secret-1" });
  });

  it("stops before service dispatch when exact project authorization refuses", async () => {
    const service = new TestSecretService();
    const authorizationError = new Error("project access denied");
    const app = ApiApplication.create({ secrets: service });
    const secrets = secretRouterOf(
      app.createCaller({
        actor: () => ({ id: "user-1" }),
        authorize: async () => {
          throw authorizationError;
        },
      }),
    );

    await expect(secrets.list({ projectId: "project-1" })).rejects.toThrow("project access denied");
    expect(service.list).not.toHaveBeenCalled();
  });

  it("validates a legacy mutation input before authorization or service dispatch", async () => {
    const service = new TestSecretService();
    const { authorize, secrets } = createCaller(service);

    await expect(
      secrets.update({
        projectId: "project-1",
        secretId: "secret-1",
        value: "",
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(authorize).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });

  it("keeps one composed service instance across callers", async () => {
    const service = new TestSecretService();
    const app = ApiApplication.create({ secrets: service });
    const callerContext = {
      actor: () => ({ id: "user-1" }),
      authorize: async () => undefined,
    };

    await secretRouterOf(app.createCaller(callerContext)).list({ projectId: "project-1" });
    await secretRouterOf(app.createCaller(callerContext)).list({ projectId: "project-2" });

    expect(service.list).toHaveBeenCalledTimes(2);
    expect(service.list).toHaveBeenNthCalledWith(1, { projectId: "project-1" });
    expect(service.list).toHaveBeenNthCalledWith(2, { projectId: "project-2" });
  });

  it("maps handled domain errors at the process boundary", async () => {
    const service = new TestSecretService();
    const error = new SecretNotFoundError();
    service.update.mockRejectedValueOnce(error);
    const { secrets } = createCaller(service);

    await expect(
      secrets.update({
        projectId: "project-1",
        secretId: "secret-1",
        value: "rotated-value",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      cause: error,
    });
  });

  /** @scenario "A schema parse inside a service is a validation failure on the application spine too" */
  it("promotes a schema parse failure inside a service to validation_error", async () => {
    const service = new TestSecretService();
    const parsed = z.object({ value: z.string().min(1) }).safeParse({ value: "" });
    if (parsed.success) throw new Error("fixture parsed");
    service.update.mockRejectedValueOnce(parsed.error);
    const { secrets } = createCaller(service);

    await expect(
      secrets.update({
        projectId: "project-1",
        secretId: "secret-1",
        value: "rotated-value",
      }),
    ).rejects.toMatchObject({
      code: "UNPROCESSABLE_CONTENT",
      message: "validation_error",
      cause: { code: "validation_error" },
    });
  });
});
