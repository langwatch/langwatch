/**
 * The seats in use that billing floors a seat line on, read from organization's seat counts.
 * @see specs/licensing/seat-quantity-floor.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { MemberSeatRepository } from "../repositories/member-seat.repository.ts";
import { createTestLicensingApp } from "./testing.ts";

const seats = { fullMembers: 5, liteMembers: 1, developers: 2 };

describe("seats in use", () => {
  const app = () =>
    createTestLicensingApp({
      repositories: {
        memberSeats: createApiFixture<MemberSeatRepository>({
          countMemberSeats: () => Promise.resolve(seats),
        }),
      },
    });

  it("counts the full seats in use", async () => {
    await expect((await app()).countFullSeatsInUse({ organizationId: "org-456" })).resolves.toBe(5);
  });

  it("counts the Developers in use apart from the full and Lite seats", async () => {
    await expect((await app()).countDevelopersInUse({ organizationId: "org-456" })).resolves.toBe(
      2,
    );
  });
});
