import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@langwatch/prisma-client/generated";
import { ModelProviderCredentialCodec } from "../model-provider.port";
import { PrismaModelProviderRepository } from "../../repositories/prisma/prisma.model-provider.repository";

class Credentials extends ModelProviderCredentialCodec {
  encode(value: Record<string, unknown> | null): unknown {
    return value === null ? null : JSON.stringify(value);
  }

  tryDecode(value: unknown): Record<string, unknown> | null {
    return typeof value === "string" ? JSON.parse(value) : null;
  }
}

const row = {
  id: "mp_1",
  organizationId: "org_1",
  provider: "openai",
  name: "OpenAI",
  enabled: true,
  routingHandle: null,
  customKeys: JSON.stringify({ OPENAI_API_KEY: "stored-key" }),
  customModels: [],
  customEmbeddingsModels: [],
  extraHeaders: [],
  rateLimitRpm: null,
  rateLimitTpm: null,
  rateLimitRpd: null,
  fallbackPriorityGlobal: null,
  providerConfig: null,
  deploymentMapping: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  scopes: [{ scopeType: "ORGANIZATION" as const, scopeId: "org_1" }],
};

describe("PrismaModelProviderRepository", () => {
  it("recognises only a routing-handle unique constraint", () => {
    const repository = PrismaModelProviderRepository.create(
      {
        modelProvider: {},
        gatewayChangeEvent: {},
        $transaction: vi.fn(),
      },
      new Credentials(),
    );
    const routingHandleConflict = new Prisma.PrismaClientKnownRequestError("conflict", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["organizationId", "routingHandle"] },
    });
    const nameConflict = new Prisma.PrismaClientKnownRequestError("conflict", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["organizationId", "name"] },
    });

    expect(repository.isRoutingHandleConflict(routingHandleConflict)).toBe(true);
    expect(repository.isRoutingHandleConflict(nameConflict)).toBe(false);
    expect(repository.isRoutingHandleConflict(new Error("boom"))).toBe(false);
  });

  it("reads a provider only inside the selected tenant and decodes credentials", async () => {
    const findFirst = vi.fn().mockResolvedValue(row);
    const repository = PrismaModelProviderRepository.create(
      {
        modelProvider: { findFirst },
        gatewayChangeEvent: {},
        $transaction: vi.fn(),
      },
      new Credentials(),
    );

    await expect(
      repository.tryFindById({ id: "mp_1", organizationId: "org_1" }),
    ).resolves.toMatchObject({
      id: "mp_1",
      organizationId: "org_1",
      customKeys: { OPENAI_API_KEY: "stored-key" },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "mp_1", organizationId: "org_1" }),
      }),
    );
  });

  it("creates encoded credentials, every scope, and a gateway-change event in one transaction", async () => {
    const create = vi.fn().mockResolvedValue(row);
    const appendChange = vi.fn().mockResolvedValue({});
    const repository = PrismaModelProviderRepository.create(
      {
        modelProvider: {},
        gatewayChangeEvent: {},
        $transaction: async (operation: (database: unknown) => unknown) =>
          operation({
            modelProvider: { create },
            gatewayChangeEvent: { create: appendChange },
          }),
      },
      new Credentials(),
    );

    await repository.create({
      ...row,
      customKeys: { OPENAI_API_KEY: "stored-key" },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customKeys: JSON.stringify({ OPENAI_API_KEY: "stored-key" }),
          scopes: {
            create: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
          },
        }),
      }),
    );
    expect(appendChange).toHaveBeenCalledWith({
      data: {
        organizationId: "org_1",
        kind: "MODEL_PROVIDER_UPDATED",
        modelProviderId: "mp_1",
        payload: expect.anything(),
      },
    });
  });

  it("replaces scope rows and preserves the credential encoding when updating", async () => {
    const update = vi.fn().mockResolvedValue({
      ...row,
      scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
    });
    const appendChange = vi.fn().mockResolvedValue({});
    const repository = PrismaModelProviderRepository.create(
      {
        modelProvider: {},
        gatewayChangeEvent: {},
        $transaction: async (operation: (database: unknown) => unknown) =>
          operation({
            modelProvider: { update },
            gatewayChangeEvent: { create: appendChange },
          }),
      },
      new Credentials(),
    );

    await repository.update({
      ...row,
      customKeys: { OPENAI_API_KEY: "stored-key" },
      scopes: [{ scopeType: "PROJECT", scopeId: "project_1" }],
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mp_1" },
        data: expect.objectContaining({
          customKeys: JSON.stringify({ OPENAI_API_KEY: "stored-key" }),
          scopes: {
            deleteMany: {},
            create: [{ scopeType: "PROJECT", scopeId: "project_1" }],
          },
        }),
      }),
    );
  });

  /** @scenario "a provider may be visible at project, team, or organization scope" */
  it("lists every row visible through the project, team, or organization scope", async () => {
    const findMany = vi.fn().mockResolvedValue([row]);
    const repository = PrismaModelProviderRepository.create(
      {
        modelProvider: { findMany },
        gatewayChangeEvent: {},
        $transaction: vi.fn(),
      },
      new Credentials(),
    );

    await expect(
      repository.listForProject([
        { scopeType: "PROJECT", scopeId: "project_1" },
        { scopeType: "TEAM", scopeId: "team_1" },
        { scopeType: "ORGANIZATION", scopeId: "org_1" },
      ]),
    ).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scopes: {
            some: {
              OR: [
                { scopeType: "PROJECT", scopeId: "project_1" },
                { scopeType: "TEAM", scopeId: "team_1" },
                { scopeType: "ORGANIZATION", scopeId: "org_1" },
              ],
            },
          },
        },
      }),
    );
  });
});
