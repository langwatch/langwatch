import { Readable } from "node:stream";

import type { GroupQueueStorage, ObjectStore } from "@langwatch/group-queue";

import type { ObjectStorage, ObjectStorageDestination } from "./members.ts";

/** Main's `mintUriForDestination`: the uri of `objectPath` at the named destination. */
export function storageUri({
  destination,
  objectPath,
}: {
  destination: ObjectStorageDestination;
  objectPath: string;
}): string {
  switch (destination.kind) {
    case "s3":
      return `s3://${destination.bucket}/${objectPath}`;
    case "file": {
      const root = destination.root.startsWith("/") ? destination.root : `/${destination.root}`;
      return `file://${root}/${objectPath}`;
    }
    case "azure":
      return `azure-blob://${destination.accountName}/${destination.container}/${objectPath}`;
    case "memory":
      throw new Error("The memory object storage has no uri for the Group Queue's durable tier.");
  }
}

/** A project's uri prefix; the queue re-mints every uri from it, so the rest is the key. */
async function prefixOf({
  storage,
  projectId,
}: {
  storage: ObjectStorage;
  projectId: string;
}): Promise<string> {
  return storageUri({ destination: await storage.destination(projectId), objectPath: "" });
}

async function keyOf(options: {
  storage: ObjectStorage;
  projectId: string;
  uri: string;
}): Promise<string> {
  const prefix = await prefixOf(options);
  if (!options.uri.startsWith(prefix)) {
    throw new Error(`A Group Queue uri does not name project "${options.projectId}"'s storage.`);
  }
  return options.uri.slice(prefix.length);
}

/** The Group Queue's durable blob tier over the object-storage member, as main's registry was. */
export function groupQueueStorage({ storage }: { storage: ObjectStorage }): GroupQueueStorage {
  const objectStoreFor = (projectId: string): ObjectStore => ({
    put: async (uri, bytes, mediaType) => {
      const key = await keyOf({ storage, projectId, uri });
      await storage.write({ projectId, key }, Readable.from([bytes]), {
        byteLength: bytes.byteLength,
        contentType: mediaType,
      });
    },
    get: async (uri) => {
      const key = await keyOf({ storage, projectId, uri });
      return Readable.from(await storage.read({ projectId, key }));
    },
  });
  return {
    objectStoreFor,
    // The destination the queue caches per project is the uri prefix it mints under.
    resolveDestination: (projectId) => prefixOf({ storage, projectId }),
    mintUri: ({ destination, key }) => {
      if (typeof destination !== "string") throw new Error("A Group Queue prefix is a string.");
      return `${destination}${key}`;
    },
  };
}
