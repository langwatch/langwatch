/**
 * @vitest-environment node
 *
 * One Stripe customer per organization, against a real Postgres.
 *
 * The unit test proves the service cleans up when it is told it lost. This
 * proves the database tells exactly one caller it lost when two checkouts
 * start at the same moment: the first write is held open in its own
 * transaction until the second is parked on its row lock, and only then
 * commits, which is the interleaving under which a write whose condition sits
 * in a subquery wins anyway.
 *
 * Stripe is a stub that mints a distinct customer id per caller, so which
 * customer the organization kept and which one was deleted can be read back.
 *
 * @see ../services/customerService.ts
 * @see specs/billing/stripe-customer.feature
 */
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import { createCustomerService } from "../services/customerService";

const ns = `stripe-customer-${nanoid(8)}`;
const slug = `--${ns}`;

let organizationId: string;

/** A Stripe that mints one customer id and remembers what it was asked to delete. */
function stripeMinting(customerId: string) {
  const create = vi.fn().mockResolvedValue({ id: customerId });
  const del = vi.fn().mockResolvedValue({ id: customerId, deleted: true });
  return {
    stripe: { customers: { create, del } } as unknown as Stripe,
    create,
    del,
  };
}

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: "ACME", slug },
  });
  organizationId = organization.id;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: organizationId } });
});

describe("the Stripe customer of an organization on Postgres", () => {
  describe("given an organization with no Stripe customer", () => {
    describe("when two checkouts start at the same moment", () => {
      /** @scenario "Two checkouts started together share one Stripe customer" */
      it("keeps the first customer, deletes the second, and answers both with the kept one", async () => {
        const first = stripeMinting(`cus_${ns}_first`);
        const second = stripeMinting(`cus_${ns}_second`);
        const checkoutWith =
          (stripe: Stripe) =>
          (tx: Parameters<typeof createCustomerService>[0]["db"]) =>
            createCustomerService({ stripe, db: tx }).getOrCreateCustomerId({
              user: { email: `buyer-${ns}@acme.test` },
              organizationId,
            });

        const answers = await raceOnOneRow({
          prisma,
          table: "Organization",
          first: checkoutWith(first.stripe),
          second: checkoutWith(second.stripe),
        });

        expect(answers.first).toBe(`cus_${ns}_first`);
        expect(answers.second).toBe(`cus_${ns}_first`);
        expect(first.del).not.toHaveBeenCalled();
        expect(second.del).toHaveBeenCalledWith(`cus_${ns}_second`);

        const organization = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        expect(organization.stripeCustomerId).toBe(`cus_${ns}_first`);
      });
    });
  });
});
