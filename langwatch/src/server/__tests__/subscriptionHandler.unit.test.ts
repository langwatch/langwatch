import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {} as unknown,
}));

vi.mock("../../../ee/licensing/server", () => {
  const handlerInstances: object[] = [];
  return {
    createLicenseHandler: vi.fn(() => {
      const instance = { __id: handlerInstances.length };
      handlerInstances.push(instance);
      return instance;
    }),
  };
});

import { getLicenseHandler } from "../subscriptionHandler";
import { createLicenseHandler } from "../../../ee/licensing/server";

describe("getLicenseHandler", () => {
  /** @scenario getLicenseHandler returns same instance */
  it("returns the same instance on repeated calls (singleton)", () => {
    const first = getLicenseHandler();
    const second = getLicenseHandler();

    expect(first).toBe(second);
    expect(createLicenseHandler).toHaveBeenCalledTimes(1);
  });
});
