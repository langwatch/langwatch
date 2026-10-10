/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { AddressConfirmationService } from "../address-confirmation.service.ts";

function confirmation(confirmed: readonly string[], { mail = true }: { mail?: boolean } = {}) {
  const asked: string[] = [];
  const service = AddressConfirmationService.create({
    isConfirmed: async ({ email }) => {
      asked.push(email);
      return confirmed.includes(email);
    },
    hasMailDelivery: async () => mail,
  });

  return { service, asked };
}

describe("AddressConfirmationService", () => {
  it("answers the session's address and whether it is confirmed", async () => {
    const { service } = confirmation(["ana@acme.com"]);

    await expect(service.getForCaller({ email: "ana@acme.com" })).resolves.toEqual({
      email: "ana@acme.com",
      confirmed: true,
      canSendConfirmation: true,
    });
    await expect(service.getForCaller({ email: "bo@acme.com" })).resolves.toEqual({
      email: "bo@acme.com",
      confirmed: false,
      canSendConfirmation: true,
    });
  });

  it("answers a session with no address as unconfirmed without asking", async () => {
    const { service, asked } = confirmation(["ana@acme.com"]);

    await expect(service.getForCaller({ email: null })).resolves.toEqual({
      email: null,
      confirmed: false,
      canSendConfirmation: true,
    });
    expect(asked).toEqual([]);
  });

  describe("given an installation with no way to send email", () => {
    it("says a confirmation cannot be sent", async () => {
      const { service } = confirmation([], { mail: false });

      await expect(service.getForCaller({ email: "bo@acme.com" })).resolves.toEqual({
        email: "bo@acme.com",
        confirmed: false,
        canSendConfirmation: false,
      });
    });

    it("refuses to send one with a named error", async () => {
      const { service } = confirmation([], { mail: false });

      await expect(service.assertCanSend()).rejects.toMatchObject({
        code: "auth_email_sending_unavailable",
      });
    });
  });

  it("lets a send through where the installation can send email", async () => {
    const { service } = confirmation([]);

    await expect(service.assertCanSend()).resolves.toBeUndefined();
  });
});
