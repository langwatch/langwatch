/**
 * Where the reader could replicate a thing to, as the capability organization
 * lends: its graph, graded by `authz.effectivePermissions` per project as main's
 * `useProjectsForCopy` was. Declared, never imported. ARCHITECTURE.md §10.1.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { authzOwnStandingSchema, type AuthzOwnStanding } from "@langwatch/authz-contract";
import { UiCopyTargets, type UiCopyTarget } from "@langwatch/browser-host/capabilities";
import type { UiScopeOrganization } from "@langwatch/organization-contract";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { uiCopyCandidates, uiCopyTargets, type UiCopyCandidate } from "../model/ui-copy-targets.ts";
import type { UiFeatureApiTransport } from "./ui-scope-queries.ts";

export const UI_EFFECTIVE_PERMISSIONS_PROCEDURE = "authz.effectivePermissions";

/** Main's cadence: a role changed elsewhere reaches an open dialog within a focus. */
const GRANTS_STALE_TIME_MS = 30_000;

/** Module-level so `useQueries` keeps the combined array stable while nothing landed. */
function landedGrants(
  results: readonly { data?: AuthzOwnStanding }[],
): readonly (AuthzOwnStanding | undefined)[] {
  return results.map((result) => result.data);
}

/** What one render read: undefined candidates until the graph lands. */
export type UiCopyTargetsReading = {
  readonly candidates: readonly UiCopyCandidate[] | undefined;
  readonly grants: ReadonlyMap<string, readonly string[]>;
  /** Starts the grants reads; called by the first screen that asks for targets. */
  readonly want: () => void;
};

/**
 * One grants read per candidate project, cached under the key auth's own read uses.
 * Nothing is read until a screen asks, as main read them only inside a copy dialog:
 * mounted at the root, every page load cost one read per project in the organization.
 */
export function useUiCopyTargetsReading({
  transport,
  organizations,
  userId,
}: {
  transport: UiFeatureApiTransport;
  /** The graph the scope reading already holds; undefined until it lands. */
  organizations: readonly UiScopeOrganization[] | undefined;
  userId: string | undefined;
}): UiCopyTargetsReading {
  const candidates = useMemo(
    () => (organizations ? uiCopyCandidates({ organizations, userId }) : void 0),
    [organizations, userId],
  );

  const [wanted, setWanted] = useState(false);
  // Deferred: a screen asks while rendering, when setting another component's state is refused.
  const want = useCallback(() => {
    if (!wanted) queueMicrotask(() => setWanted(true));
  }, [wanted]);

  const landed = useQueries({
    queries: (wanted && candidates ? candidates : []).map(({ projectId }) => {
      const input = { projectId };
      return {
        queryKey: [
          ...trpcQueryKey(UI_EFFECTIVE_PERMISSIONS_PROCEDURE, { input, type: "query" }),
          userId ?? "anonymous",
        ],
        queryFn: async () =>
          authzOwnStandingSchema.parse(
            await transport.query(UI_EFFECTIVE_PERMISSIONS_PROCEDURE, input),
          ),
        staleTime: GRANTS_STALE_TIME_MS,
      };
    }),
    combine: landedGrants,
  });

  const grants = useMemo(
    () =>
      new Map(
        (candidates ?? []).flatMap(({ projectId }, index) => {
          const read = landed[index];
          const entry: [string, readonly string[]] | undefined = read
            ? [projectId, read.permissions]
            : void 0;
          return entry ? [entry] : [];
        }),
      ),
    [candidates, landed],
  );

  return useMemo(() => ({ candidates, grants, want }), [candidates, grants, want]);
}

export class BrowserUiCopyTargets extends UiCopyTargets {
  constructor(private readonly reading: UiCopyTargetsReading) {
    super();
  }

  targets(permission: string): readonly UiCopyTarget[] | undefined {
    const { candidates, grants, want } = this.reading;
    want();
    if (!candidates) return void 0;
    return uiCopyTargets({
      candidates,
      grantsOf: (projectId) => grants.get(projectId),
      permission,
    });
  }
}

/** The capability over one render's reading; asking for targets starts the grants reads. */
export function createBrowserUiCopyTargets({
  reading,
}: {
  reading: UiCopyTargetsReading;
}): UiCopyTargets {
  return new BrowserUiCopyTargets(reading);
}
