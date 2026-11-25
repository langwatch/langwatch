import { getStoredObjectStorageScheme } from "@langwatch/stored-object-contract";

import type { StoredObjectStorageAddress } from "../repositories/stored-object-bytes.repository.ts";

/** A legacy `<scheme>://<destination>/<projectId>/<rest>` URI as the row store's address. */
export function legacyStorageAddressOf({
  projectId,
  storageUri,
}: {
  projectId: string;
  storageUri: string;
}): StoredObjectStorageAddress {
  const provider = getStoredObjectStorageScheme(storageUri);
  const path = storageUri.slice(`${provider}://`.length);
  const boundary = path.indexOf(`/${projectId}/`);
  if (boundary <= 0) {
    throw new TypeError("Legacy Stored Object location is outside its project");
  }
  return {
    provider,
    destinationId: path.slice(0, boundary),
    relativeId: path.slice(boundary + 1),
  };
}
