import { createHash } from "node:crypto";

import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import {
  TRACE_CONTENT_MEDIA,
  type TraceMediaRetention,
  type TraceMediaStore,
  type TraceMediaStorePurpose,
  TraceMediaStoreService,
} from "../../trace-media-store.service.ts";

/** One owner link a store call wrote, as Stored Objects records it (ADR-002 decision 2). */
export type FakeOwnerLink = Readonly<{
  objectId: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  retainFromMs?: number;
}>;

/**
 * Stored Objects as ADR-002 answers it: an object of the same project, purpose, SHA-256 and media
 * type is reused (`isDuplicate: true`, no bytes written) and every call links its owner.
 */
export function fakeStoredObjects(): {
  storedObjects: StoredObjectApi;
  store: (purpose?: TraceMediaStorePurpose) => TraceMediaStore;
  readonly writes: number;
  readonly owners: FakeOwnerLink[];
} {
  const byKey = new Map<string, string>();
  const owners: FakeOwnerLink[] = [];
  let writes = 0;
  const storedObjects = createApiFixture<StoredObjectApi>({
    storeFromBytes: async (input) => {
      const bytes = input.bytes as Uint8Array;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const key = [input.projectId, input.purpose, sha256, input.mediaType].join("|");
      const existing = byKey.get(key);
      const id = existing ?? `so-${sha256.slice(0, 12)}-${byKey.size}`;
      if (!existing) {
        writes += 1;
        byKey.set(key, id);
      }

      owners.push({
        objectId: id,
        purpose: input.purpose,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        ...(input.retainFromMs === undefined ? {} : { retainFromMs: input.retainFromMs }),
      });

      return {
        reference: {
          projectId: input.projectId,
          id,
          sha256,
          byteLength: bytes.byteLength,
          filename: input.filename,
          mediaType: input.mediaType,
          audience: input.audience,
        },
        isDuplicate: existing !== undefined,
      } as never;
    },
  });

  return {
    storedObjects,
    store: (purpose = TRACE_CONTENT_MEDIA) =>
      TraceMediaStoreService.create({
        storedObjects,
        purpose,
        retention: createApiFixture<TraceMediaRetention>({
          getRetentionDays: async () => 30,
        }),
      }),
    get writes() {
      return writes;
    },
    owners,
  };
}
