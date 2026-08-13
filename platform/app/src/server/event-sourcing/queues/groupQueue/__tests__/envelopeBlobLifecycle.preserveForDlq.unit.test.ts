/**
 * What `preserveForDlq` REPORTS, and what it no longer does in silence
 * (#5853 review, Aryansharma28).
 *
 * The dead-letter entry is written whether or not the body it references was
 * actually held for the quarantine window — `preserveForDlq` never throws and
 * returned `void`, so the caller stamped every entry as preserved and an operator
 * found out which ones were real by draining them and watching them fail. It now
 * reports one of three states and the caller records it on the entry.
 *
 * The second half is the silence. "No lease and no blob id" was a single branch
 * that returned with no log at all, and it covers two opposite situations: the
 * common, fully recoverable one (the body travels inside the value) and the one
 * worth an alarm (the value claims a stored body nothing can point at). Warning
 * on both would bury the second; warning on neither is where this started.
 *
 * Unit, not integration: every branch is decided from the envelope header before
 * any store is touched, and the two stores are stubbed so a rejected extend is
 * injectable without Redis.
 */

import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import type { Redis } from "ioredis";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle";
import type { EnvelopeHeader } from "../jobEnvelope";
import type { BlobRef } from "../tieredBlobStore";

const QUEUE = "{test/preserve-for-dlq}";
const TENANT = "proj-1";
const GROUP_ID = `${TENANT}/aggregate-1`;
const DLQ_WINDOW_SECONDS = 604800;

/**
 * Construction-only stub. `preserveForDlq` decides every branch from the header
 * and then calls one of the two stubbed stores, so any call landing here means a
 * raw Redis command escaped the seam under test.
 */
const unreachableRedis = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined; // not a thenable
      return () => {
        throw new Error(
          `Redis.${String(prop)}() reached — preserveForDlq should have gone through the stubbed stores`,
        );
      };
    },
  },
) as unknown as Redis;

type Stubs = {
  holdForDlq: ReturnType<typeof vi.fn>;
  refreshTtl: ReturnType<typeof vi.fn>;
};

/**
 * A lifecycle whose lease store and GQ1 blob store are spies. They are `private
 * readonly` on the class, which is a compile-time constraint only — the same
 * collaborator-swap groupQueue.deadLetterFallback.unit.test.ts uses.
 */
function makeLifecycle(): { lifecycle: EnvelopeBlobLifecycle; stubs: Stubs } {
  logger.warn.mockClear();
  const lifecycle = new EnvelopeBlobLifecycle({
    redis: unreachableRedis,
    queueName: QUEUE,
  });
  const stubs: Stubs = { holdForDlq: vi.fn(), refreshTtl: vi.fn() };
  (lifecycle as any).blobLeases = { holdForDlq: stubs.holdForDlq };
  (lifecycle as any).blobs = { refreshTtl: stubs.refreshTtl };
  return { lifecycle, stubs };
}

/** Builds an envelope directly, so a header can carry (or omit) any field. */
function envelope(header: EnvelopeHeader, body = "{}"): string {
  const headerJson = JSON.stringify(header);
  return `GQ2|${Buffer.byteLength(headerJson)}|${headerJson}${body}`;
}

const OWN_REF: BlobRef = {
  tier: "redis",
  projectId: TENANT as BlobRef["projectId"],
  hash: "abc123hash",
};

const preserve = (lifecycle: EnvelopeBlobLifecycle, value: string) =>
  lifecycle.preserveForDlq({
    value,
    groupId: GROUP_ID,
    ttlSeconds: DLQ_WINDOW_SECONDS,
  });

describe("EnvelopeBlobLifecycle.preserveForDlq — what it reports about the body", () => {
  describe("given a dead-lettered job whose body is held for the quarantine window", () => {
    describe("when the entry's body state is read", () => {
      /** @scenario a dead-lettered job says whether its body is still expected to be there */
      it("reports the reference as extended, for the window asked for", async () => {
        const { lifecycle, stubs } = makeLifecycle();
        const value = envelope({
          e: "redis",
          ref: OWN_REF,
          h: "holder-1",
        } as EnvelopeHeader);

        await expect(preserve(lifecycle, value)).resolves.toBe("extended");
        expect(stubs.holdForDlq).toHaveBeenCalledWith(
          expect.objectContaining({
            hash: OWN_REF.hash,
            tier: "redis",
            ttlSeconds: DLQ_WINDOW_SECONDS,
          }),
        );
      });

      /** @scenario a dead-lettered job says whether its body is still expected to be there */
      it("reports a GQ1 standalone blob the same way", async () => {
        const { lifecycle, stubs } = makeLifecycle();
        const value = envelope({
          e: "ref",
          r: "11111111-2222-3333-4444-555555555555",
        } as EnvelopeHeader);

        await expect(preserve(lifecycle, value)).resolves.toBe("extended");
        expect(stubs.refreshTtl).toHaveBeenCalledWith(
          expect.objectContaining({ ttlSeconds: DLQ_WINDOW_SECONDS }),
        );
      });
    });
  });

  describe("given a dead-lettered job whose body is carried inside the entry itself", () => {
    describe("when the entry's body state is read", () => {
      /** @scenario a dead-lettered job says whether its body is still expected to be there */
      it("reports the body as inline, and extends nothing", async () => {
        const { lifecycle, stubs } = makeLifecycle();
        const value = envelope({ e: "j" } as EnvelopeHeader);

        await expect(preserve(lifecycle, value)).resolves.toBe("inline");
        expect(stubs.holdForDlq).not.toHaveBeenCalled();
        expect(stubs.refreshTtl).not.toHaveBeenCalled();
      });

      /** @scenario a dead-lettered job says whether its body is still expected to be there */
      it("reports a legacy pre-envelope value as inline too", async () => {
        const { lifecycle } = makeLifecycle();

        await expect(
          preserve(lifecycle, '{"id":"evt-1","groupId":"proj-1/aggregate-1"}'),
        ).resolves.toBe("inline");
      });
    });
  });

  describe("given a dead-lettered job whose body is referenced but not held for the window", () => {
    describe("when the entry's body state is read", () => {
      /** @scenario a dead-lettered job says whether its body is still expected to be there */
      it("reports it as unextended when the ref belongs to another tenant", async () => {
        const { lifecycle, stubs } = makeLifecycle();
        const value = envelope({
          e: "redis",
          ref: { ...OWN_REF, projectId: "proj-victim" as BlobRef["projectId"] },
          h: "holder-1",
        } as EnvelopeHeader);

        // Falsifiability: report every entry as preserved and this reads
        // "extended" — the same as the two cases above, which is exactly the
        // conflation the operator cannot see through.
        await expect(preserve(lifecycle, value)).resolves.toBe("unextended");
        expect(stubs.holdForDlq).not.toHaveBeenCalled();
      });

      /** @scenario a dead-lettered job says whether its body is still expected to be there */
      it("reports it as unextended when the hold itself is rejected", async () => {
        const { lifecycle, stubs } = makeLifecycle();
        stubs.holdForDlq.mockRejectedValue(new Error("redis down"));
        const value = envelope({
          e: "redis",
          ref: OWN_REF,
          h: "holder-1",
        } as EnvelopeHeader);

        await expect(preserve(lifecycle, value)).resolves.toBe("unextended");
        // Still best-effort: a failed hold must never block the drop.
        expect(logger.warn).toHaveBeenCalled();
      });
    });
  });
});

describe("EnvelopeBlobLifecycle.preserveForDlq — the branch that used to be silent", () => {
  describe("given a dead-lettered job whose value claims a stored body it cannot point at", () => {
    describe("when the dead-letter is written", () => {
      /** @scenario a dead-letter whose body cannot be held is not written in silence */
      it("warns that the body may not be there", async () => {
        const { lifecycle } = makeLifecycle();
        // A tiered format with no ref and no holder: nothing to hold, and the
        // body is not in the value either.
        const value = envelope({ e: "redis" } as EnvelopeHeader);

        await expect(preserve(lifecycle, value)).resolves.toBe("unextended");
        // Falsifiability: this branch used to `return` with no log line at all —
        // the one path here with no signal whatsoever.
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ envelopeFormat: "redis" }),
          expect.stringContaining("no usable reference"),
        );
      });
    });
  });

  describe("given a dead-lettered job whose value cannot be read at all", () => {
    describe("when the dead-letter is written", () => {
      /** @scenario a dead-letter whose body cannot be held is not written in silence */
      it("warns that the body may not be there", async () => {
        const { lifecycle } = makeLifecycle();
        // Malformed: the header length is not a number, so the envelope will not
        // split and nothing can be said about where its body lives.
        await expect(preserve(lifecycle, "GQ2|x|{}")).resolves.toBe(
          "unextended",
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ envelopeFormat: null }),
          expect.stringContaining("no usable reference"),
        );
      });
    });
  });

  describe("given a dead-lettered job whose value carries its own body", () => {
    describe("when the dead-letter is written", () => {
      /** @scenario a dead-letter whose body cannot be held is not written in silence */
      it("stays quiet, because nothing about it is at risk", async () => {
        const { lifecycle } = makeLifecycle();

        await expect(
          preserve(lifecycle, envelope({ e: "gz" } as EnvelopeHeader)),
        ).resolves.toBe("inline");
        // The common case. Warning here would bury the case above under noise,
        // and would be wrong: the entry stores these bytes verbatim.
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * The release that FOLLOWS the preserve, for the one tier where it is destructive.
 *
 * `dropStagedJob` runs preserve → writeJobToDlq → releaseLease. GQ2 needs nothing
 * from this test: `holdForDlq` leaves a `gq:dlq` member in the lease set, so
 * `release`'s `ZCARD == 0` grace never fires and the blob outlives the call. GQ1
 * has no lease set and its release is an unconditional `UNLINK`, so preserve
 * reported `extended`, the entry was stamped with it, and the next line deleted
 * the body — the #720 failure this PR exists to close, inverted into a promise.
 *
 * Asserted as the round trip rather than on the flag, because the flag being
 * forwarded is not the property that matters; the blob still being there is.
 */
describe("EnvelopeBlobLifecycle.releaseLease — a GQ1 body the dead-letter still references", () => {
  const GQ1_BLOB_ID = "b7c1f0e2-0000-4000-8000-0000000000aa";

  /** A real GQ1 envelope: `e:"ref"` names a standalone randomUUID blob. */
  function gq1Envelope(): string {
    const headerJson = JSON.stringify({ e: "ref", r: GQ1_BLOB_ID });
    return `GQ1|${Buffer.byteLength(headerJson)}|${headerJson}`;
  }

  function makeGq1Lifecycle() {
    const blobs = { refreshTtl: vi.fn(), delete: vi.fn() };
    const lifecycle = new EnvelopeBlobLifecycle({
      redis: unreachableRedis,
      queueName: QUEUE,
    });
    (lifecycle as any).blobs = blobs;
    return { lifecycle, blobs };
  }

  describe("given a GQ1 job whose body was preserved for the quarantine window", () => {
    describe("when the drop path releases its lease straight afterwards", () => {
      /** @scenario a dead-lettered GQ1 job's blob outlives the dead-letter window */
      it("keeps the blob, so the entry's extended promise still holds", async () => {
        const { lifecycle, blobs } = makeGq1Lifecycle();
        const value = gq1Envelope();

        await expect(
          lifecycle.preserveForDlq({
            value,
            groupId: GROUP_ID,
            ttlSeconds: DLQ_WINDOW_SECONDS,
          }),
        ).resolves.toBe("extended");
        expect(blobs.refreshTtl).toHaveBeenCalledWith({
          id: GQ1_BLOB_ID,
          ttlSeconds: DLQ_WINDOW_SECONDS,
        });

        await lifecycle.releaseLease({
          values: [value],
          groupId: GROUP_ID,
          retainOffloadedBody: true,
        });

        expect(blobs.delete).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a GQ1 job that was not dead-lettered", () => {
    describe("when its lease is released on ordinary retirement", () => {
      it("still deletes the blob, because nothing else points at it", async () => {
        const { lifecycle, blobs } = makeGq1Lifecycle();

        await lifecycle.releaseLease({
          values: [gq1Envelope()],
          groupId: GROUP_ID,
        });

        // The default has to stay destructive: a GQ1 blob is private to its job,
        // so retaining every one of them would leak a blob per completed job.
        expect(blobs.delete).toHaveBeenCalledWith({ id: GQ1_BLOB_ID });
      });
    });
  });
});
