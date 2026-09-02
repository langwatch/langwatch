/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedure is mounted by the process, and the
 * router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `governance` is a mount point on the root
 * router and tRPC hashes that path into the React Query cache key; spell it
 * differently and this hook quietly stops sharing a cache with the
 * `api.governance.resolveHome` call sites that have not moved.
 *
 * The answer is `PersonaResolution` — `@langwatch/enterprise-governance-contract`'s
 * own shape, restated here rather than imported so a core web package does not
 * take an enterprise dependency to read four booleans off a wire. The four
 * fields below are the ones the landing redirect reads; the procedure answers
 * every one of them on every call, which is why `use-landing-redirect` treats
 * "answered" and "resolved" as the same thing.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";

export type NavigationHomeResolution = {
  destination: string;
  isOverride: boolean;
  intentPinned: boolean;
  governanceUiEnabled: boolean;
};

export type NavigationApiMap = {
  organization: {
    /**
     * The workspace graph the switcher offers and the landing decision reads.
     *
     * The SAME PATH AND THE SAME INPUT the application shell already asks with,
     * which under tRPC's path-plus-input cache key is the same entry: the graph
     * is fetched once for the document however many halves of the product want
     * it. `members` is narrowed by the procedure to the caller's own row, which
     * is what makes reading a role off `members[0]` correct here.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          slug: string;
          members?: Array<{ role: string }>;
          teams: Array<{
            id: string;
            name: string;
            isPersonal?: boolean | null;
            members?: Array<{ userId: string }>;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };
  };

  governance: {
    /** Which `/` destination the authenticated reader lands on. */
    resolveHome: {
      query: {
        input: { organizationId: string };
        output: NavigationHomeResolution;
      };
    };
  };
};

export const navigationApi = createFeatureApi<NavigationApiMap>();
