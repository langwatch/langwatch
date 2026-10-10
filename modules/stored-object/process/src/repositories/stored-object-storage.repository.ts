/**
 * Byte I/O for stored objects, addressed by storage URI.
 */
import type { Readable } from "node:stream";

export abstract class StoredObjectStorageRepository {
  // Declared as properties of function type, not method shorthand: tests hold
  // a mock registry and reference these members unbound (e.g.
  // `vi.mocked(registry.put)`), which `typescript/unbound-method` flags
  // against method shorthand. None carries `this` state, so the property
  // form changes nothing at runtime.
  abstract get: (uri: string) => Promise<Readable>;
  abstract put: (uri: string, bytes: Buffer, mediaType: string) => Promise<void>;
  abstract delete: (uri: string) => Promise<void>;
  abstract exists: (uri: string) => Promise<boolean>;
}
