/**
 * @vitest-environment node
 *
 * Real Postgres coverage for user-scoped Traces Explorer tour dismissal.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("user Traces Explorer tour preference", () => {
  const userId = `tour-pref-${nanoid(8)}`;
  const otherUserId = `tour-pref-other-${nanoid(8)}`;

  const createCaller = (id: string) =>
    appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id, email: `${id}@example.com`, name: "Tour Tester" },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }),
    );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, email: `${userId}@example.com` },
        { id: otherUserId, email: `${otherUserId}@example.com` },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.user.updateMany({
      where: { id: { in: [userId, otherUserId] } },
      data: { tracesExplorerTourDismissedAt: null },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    });
  });

  /** @scenario Tour dismissal follows the user to another browser */
  it("round-trips the dismissal through Postgres for a fresh caller", async () => {
    const firstBrowser = createCaller(userId);
    expect(await firstBrowser.user.getTraceExplorerTourPreference({})).toEqual({
      dismissed: false,
      dismissedAt: null,
    });

    const dismissed = await firstBrowser.user.dismissTraceExplorerTour({});
    expect(dismissed.dismissed).toBe(true);
    expect(dismissed.dismissedAt).toBeInstanceOf(Date);

    const secondBrowser = createCaller(userId);
    const persisted = await secondBrowser.user.getTraceExplorerTourPreference(
      {},
    );
    expect(persisted.dismissed).toBe(true);
    expect(persisted.dismissedAt).toEqual(dismissed.dismissedAt);

    const databaseUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { tracesExplorerTourDismissedAt: true },
    });
    expect(databaseUser.tracesExplorerTourDismissedAt).toEqual(
      dismissed.dismissedAt,
    );
  });

  /** @scenario Dismissing the tour in one project suppresses it in another */
  it("stores one preference without a project scope", async () => {
    const caller = createCaller(userId);
    await caller.user.dismissTraceExplorerTour({});

    expect(await caller.user.getTraceExplorerTourPreference({})).toMatchObject({
      dismissed: true,
    });
  });

  it("keeps dismissal isolated to the authenticated user", async () => {
    await createCaller(userId).user.dismissTraceExplorerTour({});

    expect(
      await createCaller(otherUserId).user.getTraceExplorerTourPreference({}),
    ).toEqual({ dismissed: false, dismissedAt: null });
  });
});
