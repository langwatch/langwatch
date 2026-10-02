/**
 * The URL to draw for a person's image. A stored avatar resolves to a signed URL minted for its
 * reference; any other image is used as it stands. Pending or failed mints answer null.
 * Spec: specs/settings/user-avatar.feature
 */

import { type ContractApiMap, createModuleApi } from "@langwatch/api/web";
import type { userTrpc } from "@langwatch/user-contract";

/** The one procedure family this kit calls, derived from its owner's contract. */
const userApi = createModuleApi<ContractApiMap<typeof userTrpc>>();

const STORED_AVATAR = /^\/api\/user-avatar\/([^/]+)\/([^/?#]+)$/;

/** The URL lapses after 15 minutes; ask again before that. */
const MINT_STALE_MS = 10 * 60_000;

export function useUserAvatarUrl(image?: string | null): string | null {
  const stored = image ? STORED_AVATAR.exec(image) : null;
  const [, projectId = "", userAvatarId = ""] = stored ?? [];
  const mint = userApi.user.getAvatarUrl.useQuery(
    { projectId, userAvatarId },
    {
      enabled: stored !== null,
      staleTime: MINT_STALE_MS,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  if (stored) return mint.data?.url ?? null;
  return image ?? null;
}
