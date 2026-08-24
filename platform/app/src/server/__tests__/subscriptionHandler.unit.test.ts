import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {} as unknown,
}));

import { getLicenseHandler } from "~/runtime/app/licensing";

describe("getLicenseHandler", () => {
  /** @scenario getLicenseHandler returns same instance */
  it("returns the same instance on repeated calls (singleton)", () => {
    const first = getLicenseHandler();
    const second = getLicenseHandler();

    expect(first).toBe(second);
  });
});
