import { describe, expect, it } from "vitest";

import { PrismaPrivateModelEndpointRepository } from "../prisma.private-model-endpoint.repository.ts";

/**
 * The unique (organizationId, hostname) index is what refuses the second of two concurrent binds
 * of one hostname; the service reads that refusal through `isHostnameTaken`.
 */
describe("PrismaPrivateModelEndpointRepository.isHostnameTaken", () => {
  const repository = PrismaPrivateModelEndpointRepository.create(
    {} as Parameters<typeof PrismaPrivateModelEndpointRepository.create>[0],
  );

  it.each([
    [
      "the classic engine's target",
      { code: "P2002", meta: { target: ["organizationId", "hostname"] } },
    ],
    [
      "a driver adapter's constraint",
      {
        code: "P2002",
        meta: { driverAdapterError: { cause: { constraint: { fields: ['"hostname"'] } } } },
      },
    ],
    ["an unnamed unique violation", { code: "P2002" }],
  ])("recognises %s", (_name, error) => {
    expect(repository.isHostnameTaken(error)).toBe(true);
  });

  it.each([
    ["another constraint", { code: "P2002", meta: { target: ["id"] } }],
    ["another error code", { code: "P2025" }],
    ["a plain error", new Error("connection reset")],
  ])("does not mistake %s for it", (_name, error) => {
    expect(repository.isHostnameTaken(error)).toBe(false);
  });
});
