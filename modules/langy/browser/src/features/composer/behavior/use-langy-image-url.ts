/**
 * The URL an image a message carries can be drawn from. Its stored address is exchanged for a
 * short-lived signed URL; the API-key file route is not the browser's to read.
 */
import { langyAttachmentAddressOf } from "@langwatch/langy-contract";

import { api } from "../../../behavior/langy-api.ts";

/** A signed URL lapses after 15 minutes; ask again before that. */
const MINT_STALE_MS = 10 * 60_000;

export type LangyImageUrl =
  | Readonly<{ status: "ready"; url: string }>
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "failed" }>;

export function useLangyImageUrl({ url }: { url: string }): LangyImageUrl {
  const address = langyAttachmentAddressOf(url);
  const stored = address === "not_stored" ? undefined : address;
  const mint = api.storedObjects.getReadUrl.useQuery(
    {
      projectId: stored?.projectId ?? "",
      storedObjectId: stored?.objectId ?? "",
      filename: stored?.filename,
    },
    { enabled: !!stored, staleTime: MINT_STALE_MS, retry: false, refetchOnWindowFocus: false },
  );
  if (!stored) return { status: "ready", url };
  if (mint.data) return { status: "ready", url: mint.data.url };
  if (mint.isError) return { status: "failed" };
  return { status: "pending" };
}
