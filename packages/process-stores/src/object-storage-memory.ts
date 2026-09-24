import type { ObjectDigest, ObjectStorage, StoredObjectAddress } from "./members.ts";
/**
 * The memory twin of the object-storage member: bytes held per project and
 * key, written and read as the same streams, measured by the same body check.
 */
import {
  measureBody,
  StoredObjectNotFoundError,
  UnknownStorageProjectError,
} from "./object-storage-backend.ts";

interface HeldObject {
  readonly chunks: readonly Uint8Array[];
  readonly digest: ObjectDigest;
}

export function memoryObjectStorage(): ObjectStorage {
  const held = new Map<string, HeldObject>();
  const slot = (at: StoredObjectAddress): string => {
    if (at.projectId === "") throw new UnknownStorageProjectError(at.projectId);
    return `${at.projectId}\u0000${at.key}`;
  };
  const find = (at: StoredObjectAddress): HeldObject => {
    const object = held.get(slot(at));
    if (object === undefined) throw new StoredObjectNotFoundError(at.projectId, at.key);
    return object;
  };

  return {
    async write(at, body, facts) {
      const target = slot(at);
      const measured = measureBody({ at, body, facts });
      const chunks: Uint8Array[] = [];
      for await (const chunk of measured.chunks) chunks.push(Uint8Array.from(chunk));
      const digest = measured.digest();
      held.set(target, { chunks, digest });
      return digest;
    },
    async read(at) {
      const { chunks } = find(at);
      return (async function* () {
        yield* chunks;
      })();
    },
    digest: (at) => Promise.resolve(find(at).digest),
    remove(at) {
      held.delete(slot(at));
      return Promise.resolve();
    },
    signUpload(at) {
      slot(at);
      return Promise.resolve({ kind: "through-process" });
    },
    destination(projectId) {
      slot({ projectId, key: "" });
      return Promise.resolve({ kind: "memory" });
    },
    probe(projectId) {
      slot({ projectId, key: "" });
      return Promise.resolve();
    },
  };
}
