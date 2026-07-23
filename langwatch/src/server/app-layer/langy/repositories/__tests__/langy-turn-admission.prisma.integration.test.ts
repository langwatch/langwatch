import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { PrismaLangyTurnAdmissionRepository } from "../langy-turn-admission.prisma.repository";

const namespace = `langy-admission-${nanoid(10)}`;
const projectId = `${namespace}-project`;
const userId = `${namespace}-user`;
const conversationId = `${namespace}-conversation`;

const repository = new PrismaLangyTurnAdmissionRepository(prisma);

function identity(requestSuffix: string, turnSuffix = requestSuffix) {
  return {
    projectId,
    userId,
    idempotencyKey: `${namespace}-request-${requestSuffix}`,
    conversationId,
    turnId: `${namespace}-turn-${turnSuffix}`,
  };
}

afterEach(async () => {
  await prisma.langyActiveTurn.deleteMany({ where: { projectId } });
  await prisma.langyTurnRequest.deleteMany({ where: { projectId } });
});

describe("PrismaLangyTurnAdmissionRepository", () => {
  it("replays the original identities after a logical send commits", async () => {
    const request = identity("stable");
    const claim = await repository.claim(request);
    expect(claim).toEqual(
      expect.objectContaining({
        kind: "claimed",
        conversationId,
        turnId: request.turnId,
      }),
    );
    if (claim.kind !== "claimed") throw new Error("expected claimed admission");

    await expect(repository.claim(request)).resolves.toEqual({
      kind: "pending",
    });
    await repository.commit({ ...request, claimToken: claim.claimToken });
    await expect(
      repository.commit({ ...request, claimToken: claim.claimToken }),
    ).resolves.toBeUndefined();

    // A true retry re-derives the SAME turn id (it is a hash of
    // who+key+content); only the speculative conversation id may differ.
    await expect(
      repository.claim({
        ...request,
        conversationId: `${namespace}-speculative-other-conversation`,
      }),
    ).resolves.toEqual({
      kind: "replay",
      conversationId,
      turnId: request.turnId,
    });

    // A different turn id under the same key means different content —
    // never replay the original send over it.
    await expect(
      repository.claim({
        ...request,
        conversationId: `${namespace}-speculative-other-conversation`,
        turnId: `${namespace}-speculative-other-turn`,
      }),
    ).resolves.toEqual({ kind: "mismatch" });
  });

  it("refuses a commit that does not own the preparation lease", async () => {
    const request = identity("commit-fence");
    const claim = await repository.claim(request);
    if (claim.kind !== "claimed") throw new Error("expected claim");

    await expect(
      repository.commit({ ...request, claimToken: "wrong-token" }),
    ).rejects.toThrow("receipt commit lost its claim");
    await expect(repository.claim(request)).resolves.toEqual({
      kind: "pending",
    });

    await expect(
      repository.commit({ ...request, claimToken: claim.claimToken }),
    ).resolves.toBeUndefined();
  });

  it("promotes a preparation from the canonical acceptance event", async () => {
    const request = identity("event-recovery");
    const claim = await repository.claim(request);
    if (claim.kind !== "claimed") throw new Error("expected claim");

    await repository.confirmAccepted({
      projectId,
      conversationId,
      turnId: request.turnId,
    });

    await expect(repository.claim(request)).resolves.toEqual({
      kind: "replay",
      conversationId,
      turnId: request.turnId,
    });
  });

  it("admits only one active turn and fences terminal release by turn id", async () => {
    const first = identity("first");
    const firstClaim = await repository.claim(first);
    if (firstClaim.kind !== "claimed") throw new Error("expected first claim");
    await repository.commit({ ...first, claimToken: firstClaim.claimToken });

    await expect(repository.claim(identity("second"))).resolves.toEqual({
      kind: "busy",
    });

    await repository.release({
      projectId,
      conversationId,
      turnId: `${namespace}-wrong-turn`,
    });
    await expect(repository.claim(identity("third"))).resolves.toEqual({
      kind: "busy",
    });

    await repository.release({
      projectId,
      conversationId,
      turnId: first.turnId,
    });
    await expect(repository.claim(identity("fourth"))).resolves.toEqual(
      expect.objectContaining({ kind: "claimed" }),
    );
  });

  it("reclaims a committed row abandoned for over ten minutes", async () => {
    const first = identity("abandoned");
    const firstClaim = await repository.claim(first);
    if (firstClaim.kind !== "claimed") throw new Error("expected first claim");
    await repository.commit({ ...first, claimToken: firstClaim.claimToken });

    // A worker that dies without ever publishing a terminal event (confirmed
    // live on this stack: haven restarts can orphan an in-flight worker
    // subprocess) never triggers langyTurnAdmissionLifecycleSubscriber's
    // release() — nothing else ever deletes this row. Back-date its
    // updatedAt directly (bypassing Prisma's own @updatedAt management,
    // which would just stamp "now" again) to simulate that abandonment
    // without waiting ten real minutes. Plain JS Date math, not a raw SQL
    // `now()`: the column is `timestamp without time zone`, so a DB-side
    // `now()` (evaluated in the session's local zone) round-trips through
    // Prisma as if it were UTC — a real skew, not just a test artifact.
    await prisma.langyActiveTurn.updateMany({
      where: { projectId, conversationId },
      data: { updatedAt: new Date(Date.now() - 11 * 60 * 1000) },
    });

    await expect(repository.claim(identity("recovered"))).resolves.toEqual(
      expect.objectContaining({ kind: "claimed" }),
    );
  });

  it("still refuses a committed row inside the ten-minute abandonment window", async () => {
    const first = identity("freshly-committed");
    const firstClaim = await repository.claim(first);
    if (firstClaim.kind !== "claimed") throw new Error("expected first claim");
    await repository.commit({ ...first, claimToken: firstClaim.claimToken });

    await expect(repository.claim(identity("too-soon"))).resolves.toEqual({
      kind: "busy",
    });
  });

  it("aborts only the matching preparation and lets its request retry", async () => {
    const request = identity("abortable");
    const firstClaim = await repository.claim(request);
    if (firstClaim.kind !== "claimed") throw new Error("expected first claim");

    await repository.abort({ ...request, claimToken: "wrong-token" });
    await expect(repository.claim(request)).resolves.toEqual({
      kind: "pending",
    });

    await repository.abort({ ...request, claimToken: firstClaim.claimToken });
    const retried = await repository.claim(request);
    expect(retried).toEqual(
      expect.objectContaining({
        kind: "claimed",
        conversationId,
        turnId: request.turnId,
      }),
    );
    if (retried.kind !== "claimed") throw new Error("expected retry claim");
    expect(retried.claimToken).not.toBe(firstClaim.claimToken);
  });
});
