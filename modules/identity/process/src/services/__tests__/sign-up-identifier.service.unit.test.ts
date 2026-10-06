/**
 * @vitest-environment node
 * @see specs/identity/identifier-model.feature
 */
import type { AttachIdentifierCommandData } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SignUpIdentifierService } from "../sign-up-identifier.service.ts";

const REGISTRATION = {
  tenantId: "user_sam",
  userId: "user_sam",
  occurredAt: 1_700_000_000_500,
  accountId: "acc_sam",
  createdAtMs: 1_700_000_000_000,
  email: "sam@acme.com",
};

function service() {
  const attached: AttachIdentifierCommandData[] = [];
  const signUps = SignUpIdentifierService.create({
    identity: { attachIdentifier: async (input) => attached.push(input) },
  });
  return { signUps, attached };
}

describe("a password sign-up's credential identifier", () => {
  /** @scenario "A password sign-up states its credential identifier from the registration fact" */
  it("is attached against the registered row, at the row's creation time", async () => {
    const { signUps, attached } = service();

    await signUps.attachRegistered({ registration: REGISTRATION });

    expect(attached).toEqual([
      expect.objectContaining({
        tenantId: "user_sam",
        userId: "user_sam",
        accountId: "acc_sam",
        provider: "credential",
        providerId: "credential",
        providerAccountId: "user_sam",
        value: "sam@acme.com",
        occurredAtMs: 1_700_000_000_000,
        ceremony: { flow: "sign-up" },
        actor: { type: "user", id: "user_sam" },
      }),
    ]);
  });

  /** @scenario "A password sign-up states its credential identifier from the registration fact" */
  it("restates the same command when the fact is redelivered", async () => {
    const { signUps, attached } = service();

    await signUps.attachRegistered({ registration: REGISTRATION });
    await signUps.attachRegistered({ registration: REGISTRATION });

    expect(attached).toHaveLength(2);
    expect(attached[0]?.commandId).toBe(attached[1]?.commandId);
  });

  /** @scenario "A password sign-up states its credential identifier from the registration fact" */
  it("attaches nothing for a fact recorded before registrations named their row", async () => {
    const { signUps, attached } = service();

    await signUps.attachRegistered({
      registration: { tenantId: "user_sam", userId: "user_sam", occurredAt: 1 },
    });

    expect(attached).toEqual([]);
  });
});
