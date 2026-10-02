import { type ContractApiMap, createModuleApi } from "@langwatch/api/web";
import type { storedObjectTrpc } from "@langwatch/stored-object-contract";

import { parseStoredObjectReference } from "../../model/stored-object/parse-stored-object-reference.ts";

/** The one procedure family this kit calls, derived from its owner's contract. */
const storedObjectApi = createModuleApi<ContractApiMap<typeof storedObjectTrpc>>();

/** The URL lapses after 15 minutes; ask again before that. */
const MINT_STALE_MS = 10 * 60_000;

export type StoredObjectUrl =
  | { status: "ready"; url: string }
  | { status: "pending" }
  | { status: "failed" };

/**
 * The URL a media element may load for `reference`. A stored-object reference
 * is exchanged for a short-lived signed URL; any other address is already
 * loadable and answers at once. An id-only legacy reference needs `projectId`.
 */
export function useStoredObjectUrl({
  reference,
  projectId,
  filename,
}: {
  reference: string;
  projectId?: string;
  filename?: string;
}): StoredObjectUrl {
  const parsed = parseStoredObjectReference(reference);
  const owner = parsed?.projectId ?? projectId;
  const mint = storedObjectApi.storedObjects.getReadUrl.useQuery(
    {
      projectId: owner ?? "",
      storedObjectId: parsed?.storedObjectId ?? "",
      filename: filename ?? parsed?.filename,
    },
    {
      enabled: !!parsed && !!owner,
      staleTime: MINT_STALE_MS,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  if (!parsed) return { status: "ready", url: reference };
  if (mint.data) return { status: "ready", url: mint.data.url };
  if (!owner || mint.isError) return { status: "failed" };
  return { status: "pending" };
}
