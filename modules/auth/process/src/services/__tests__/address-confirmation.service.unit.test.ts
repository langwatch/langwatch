/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { AddressConfirmationService } from "../address-confirmation.service.ts";

function confirmation(confirmed: readonly string[]) {
  const asked: string[] = [];
  const service = AddressConfirmationService.create({
    isConfirmed: async ({ email }) => {
      asked.push(email);
      return confirmed.includes(email);
    },
  });

  return { service, asked };
}

describe("AddressConfirmationService", () => {
  it("answers the session's address and whether it is confirmed", async () => {
    const { service } = confirmation(["ana@acme.com"]);

    await expect(service.getForCaller({ email: "ana@acme.com" })).resolves.toEqual({
      email: "ana@acme.com",
      confirmed: true,
    });
    await expect(service.getForCaller({ email: "bo@acme.com" })).resolves.toEqual({
      email: "bo@acme.com",
      confirmed: false,
    });
  });

  it("answers a session with no address as unconfirmed without asking", async () => {
    const { service, asked } = confirmation(["ana@acme.com"]);

    await expect(service.getForCaller({ email: null })).resolves.toEqual({
      email: null,
      confirmed: false,
    });
    expect(asked).toEqual([]);
  });
});
