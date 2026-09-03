import { Readable } from "node:stream";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TraceSpoolLegacyObjectPort,
  TraceSpoolStoragePort,
  type TraceSpoolObjectStore,
} from "../../ports/trace-spool-storage.port";
import {
  MAX_SPOOL_BYTES,
  SPOOL_REF_V2,
  SpoolDestinationUnsupportedError,
  SpoolStreamTooLargeError,
  TraceSpoolService,
} from "../trace-spool.service";

/**
 * The object path, the reference marker and the read cap are a wire format
 * between two processes. Every one of them is pinned as a literal here rather
 * than read off the application's source, which would die the moment either
 * file moves and would only ever prove the two files are the same file.
 */
const S3: StoredObjectStorageDestination = { kind: "s3", bucket: "objects" };
const FILE: StoredObjectStorageDestination = { kind: "file", root: "/var/objects" };
const AZURE: StoredObjectStorageDestination = {
  kind: "azure",
  accountName: "acct",
  container: "spool",
};

class RecordingObjectStore implements TraceSpoolObjectStore {
  readonly puts: { uri: string; bytes: Buffer; mediaType: string }[] = [];
  readonly gets: string[] = [];
  readonly deletes: string[] = [];
  body: Buffer | Readable = Buffer.from("spooled");

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    this.puts.push({ uri, bytes, mediaType });
  }

  async get(uri: string): Promise<Readable> {
    this.gets.push(uri);
    return this.body instanceof Readable ? this.body : Readable.from([this.body]);
  }

  async delete(uri: string): Promise<void> {
    this.deletes.push(uri);
  }
}

class Storage extends TraceSpoolStoragePort {
  readonly store = new RecordingObjectStore();
  readonly resolved: string[] = [];

  constructor(
    private readonly destination: StoredObjectStorageDestination,
    readonly azureRetentionConfirmed: boolean = false,
  ) {
    super();
  }

  objectStoreFor(_projectId: string): TraceSpoolObjectStore {
    return this.store;
  }

  async resolveDestination(projectId: string): Promise<StoredObjectStorageDestination> {
    this.resolved.push(projectId);
    return this.destination;
  }
}

class LegacyObjects extends TraceSpoolLegacyObjectPort {
  readonly reads: { projectId: string; key: string }[] = [];
  readonly deletes: { projectId: string; key: string }[] = [];

  async read(input: { projectId: string; key: string }): Promise<Readable> {
    this.reads.push(input);
    return Readable.from([Buffer.from("legacy")]);
  }

  async delete(input: { projectId: string; key: string }): Promise<void> {
    this.deletes.push(input);
  }
}

const identity = {
  spoolRef: SPOOL_REF_V2,
  projectId: "project-1",
  traceId: "trace-1",
  spanId: "span-1",
};

describe("TraceSpoolService", () => {
  let storage: Storage;
  let legacy: LegacyObjects;

  beforeEach(() => {
    storage = new Storage(S3);
    legacy = new LegacyObjects();
  });

  const service = (): TraceSpoolService =>
    TraceSpoolService.create({ storage, legacyObjects: legacy });

  describe("given a project on S3", () => {
    describe("when an oversized payload is spooled", () => {
      /** @scenario "The transient object path carries the lifecycle prefix first" */
      it("writes under the lifecycle prefix with the tenant below it", async () => {
        await service().putSpool({ ...identity, body: Buffer.from("payload") });

        expect(storage.store.puts).toHaveLength(1);
        expect(storage.store.puts[0]!.uri).toBe(
          "s3://objects/trace-blobs/spool/project-1/trace-1/span-1",
        );
        expect(storage.store.puts[0]!.mediaType).toBe("application/octet-stream");
      });

      /** @scenario "The transient object path carries the lifecycle prefix first" */
      it("answers the location-free v2 marker", async () => {
        const ref = await service().putSpool({ ...identity, body: Buffer.from("payload") });

        expect(ref).toBe("spool:v2");
      });
    });

    describe("when the command's ids are not safe path segments", () => {
      /** @scenario "An id that is not a safe path segment is hashed, not escaped" */
      it("hashes the offending segment instead of escaping it", async () => {
        await service().putSpool({
          projectId: "project-1",
          traceId: "../../etc",
          spanId: "span-1",
          body: Buffer.from("payload"),
        });

        const uri = storage.store.puts[0]!.uri;
        expect(uri).not.toContain("..");
        expect(uri).toMatch(
          /^s3:\/\/objects\/trace-blobs\/spool\/project-1\/[0-9a-f]{64}\/span-1$/,
        );
      });
    });

    describe("when a tampered reference names another tenant", () => {
      /** @scenario "The spool object path is derived from the command, never read from it" */
      it("reads the object its own ids derive", async () => {
        await service().getSpool({ ...identity, spoolRef: "spool:v2-but-tampered" });

        expect(storage.store.gets).toEqual([
          "s3://objects/trace-blobs/spool/project-1/trace-1/span-1",
        ]);
      });
    });

    describe("when the spool object exceeds the read cap", () => {
      /** @scenario "A spool object larger than the cap is refused rather than buffered" */
      it("aborts the read", async () => {
        storage.store.body = Readable.from([Buffer.alloc(MAX_SPOOL_BYTES + 1)]);

        await expect(service().getSpool(identity)).rejects.toBeInstanceOf(SpoolStreamTooLargeError);
      });

      it("caps at fifty mebibytes", () => {
        expect(MAX_SPOOL_BYTES).toBe(52_428_800);
      });
    });
  });

  describe("given a project on the local filesystem", () => {
    beforeEach(() => {
      storage = new Storage(FILE);
    });

    describe("when an oversized payload is spooled", () => {
      /** @scenario "A write refuses a destination that cannot reap an orphan" */
      it("refuses the write by name", async () => {
        await expect(
          service().putSpool({ ...identity, body: Buffer.from("payload") }),
        ).rejects.toBeInstanceOf(SpoolDestinationUnsupportedError);
        expect(storage.store.puts).toHaveLength(0);
      });
    });

    describe("when an already-written object is read", () => {
      /** @scenario "A write refuses a destination that cannot reap an orphan" */
      it("still reads it, because the guard is a write-time rule", async () => {
        await expect(service().getSpool(identity)).resolves.toEqual(Buffer.from("spooled"));
      });
    });
  });

  describe("given a project on Azure Blob storage", () => {
    describe("when the operator has not confirmed orphan retention", () => {
      beforeEach(() => {
        storage = new Storage(AZURE, false);
      });

      /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
      it("refuses the write", async () => {
        await expect(
          service().putSpool({ ...identity, body: Buffer.from("payload") }),
        ).rejects.toBeInstanceOf(SpoolDestinationUnsupportedError);
      });

      /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
      it("still deletes, so turning the flag back off cannot manufacture orphans", async () => {
        await service().deleteSpool(identity);

        expect(storage.store.deletes).toEqual([
          "azure-blob://acct/spool/trace-blobs/spool/project-1/trace-1/span-1",
        ]);
      });
    });

    describe("when the operator has confirmed orphan retention", () => {
      beforeEach(() => {
        storage = new Storage(AZURE, true);
      });

      /** @scenario "Azure refuses until the operator asserts the lifecycle rule" */
      it("writes the object", async () => {
        await service().putSpool({ ...identity, body: Buffer.from("payload") });

        expect(storage.store.puts[0]!.uri).toBe(
          "azure-blob://acct/spool/trace-blobs/spool/project-1/trace-1/span-1",
        );
      });
    });
  });

  describe("given a command carrying a v1 spool key", () => {
    const legacyRef = "trace-blobs/spool/project-1/trace-1/span-1";

    describe("when the key names the command's own tenant", () => {
      it("reads it through the legacy transport", async () => {
        const body = await service().getSpool({ ...identity, spoolRef: legacyRef });

        expect(body).toEqual(Buffer.from("legacy"));
        expect(legacy.reads).toEqual([{ projectId: "project-1", key: legacyRef }]);
      });
    });

    describe("when the key names a different tenant", () => {
      const foreign = "trace-blobs/spool/project-2/trace-1/span-1";

      /** @scenario "A legacy reference is pinned to the command's own tenant" */
      it("refuses the read", async () => {
        await expect(service().getSpool({ ...identity, spoolRef: foreign })).rejects.toThrow(
          /Refusing to read spool object/,
        );
        expect(legacy.reads).toHaveLength(0);
      });

      /** @scenario "A legacy reference is pinned to the command's own tenant" */
      it("refuses the delete and says so, rather than swallowing it", async () => {
        const logger = { warn: vi.fn() };

        await TraceSpoolService.create({
          storage,
          legacyObjects: legacy,
          logger: logger as never,
        }).deleteSpool({ ...identity, spoolRef: foreign });

        expect(legacy.deletes).toHaveLength(0);
        expect(logger.warn).toHaveBeenCalledWith(
          { projectId: "project-1", traceId: "trace-1", spanId: "span-1" },
          "Refused a cross-tenant v1 spool delete",
        );
      });
    });

    describe("when the composition has no legacy transport", () => {
      it("refuses by name rather than resolving it somewhere else", async () => {
        await expect(
          TraceSpoolService.create({ storage }).getSpool({ ...identity, spoolRef: legacyRef }),
        ).rejects.toThrow(/no v1 object transport/);
      });
    });
  });

  describe("given the eager delete after the event log insert", () => {
    describe("when the object store fails", () => {
      it("swallows the failure, because the lifecycle rule is the safety net", async () => {
        vi.spyOn(storage.store, "delete").mockRejectedValue(new Error("s3 down"));

        await expect(service().deleteSpool(identity)).resolves.toBeUndefined();
      });
    });
  });
});
