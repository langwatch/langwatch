/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `scimToken` is a mount point on the root
 * router and tRPC hashes that path into the React Query cache key.
 *
 * THE TOKEN IS RETURNED ONCE. `generate` is the only place the plaintext bearer
 * ever exists on this side of the wire; `list` answers metadata and never a
 * secret, which is why the row type below has no token field at all and why the
 * screen keeps the minted one in local state until the dialog closes.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";

/** The organization every SCIM procedure is scoped to. */
type OrganizationScope = { organizationId: string };

/** One bearer token, as the table renders it: metadata, never the secret. */
export type ScimTokenRow = {
  id: string;
  description: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type ScimApiMap = {
  scimToken: {
    list: { query: { input: OrganizationScope; output: ScimTokenRow[] } };

    /** The one and only time the plaintext bearer crosses the wire. */
    generate: {
      mutation: {
        input: OrganizationScope & { description?: string };
        output: { token: string };
      };
    };

    revoke: {
      mutation: { input: OrganizationScope & { tokenId: string }; output: unknown };
    };
  };
};

/**
 * The SCIM family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy.
 */
export const scimApi = createFeatureApi<ScimApiMap>();
