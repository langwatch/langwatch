/**
 * useCapabilityData — the ONE hydration seam between a capability card and the
 * product's own API.
 */

import { CLI_SUBRESOURCE_VERBS, type CliResultDigest } from "@langwatch/langy-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { api } from "../../../behavior/langy-api.ts";
import {
  CAPABILITY_HYDRATORS,
  type CapabilityHydratedRow,
  type CapabilityHydration,
  type CapabilityHydrator,
} from "./capabilities/capability-hydrators.ts";
import type { CapabilityCommand } from "../../../model/langy-capability-digest.ts";

/** How many rows a card draws, and therefore how many this hook hydrates. */
const DEFAULT_MAX_ROWS = 5;

export type CapabilityDataStatus = "idle" | "hydrating" | "hydrated" | "unavailable";

export interface CapabilityDataInput {
  /** The parsed command — known from the tool START frame. */
  command?: CapabilityCommand | null;
  /** The settled digest — arrives with the END frame / durable part. */
  digest?: CliResultDigest | null;
  /** How many rows the card will draw. Defaults to the card row cap. */
  maxRows?: number;
}

export interface CapabilityData {
  status: CapabilityDataStatus;
  rows: CapabilityHydratedRow[];
  /** Rows hydrated so far — the numerator of a progress fraction. */
  loadedCount: number;
  /** What the result matched in total, when anything reported it. */
  totalCount: number | null;
  isHydrating: boolean;
}

const IDLE: CapabilityData = {
  status: "idle",
  rows: [],
  loadedCount: 0,
  totalCount: null,
  isHydrating: false,
};

/** How this capability fetches: by the ids the answer named, by its query, or not at all. */
function hydrationMode({
  canHydrateByIds,
  canHydrateByQuery,
}: {
  canHydrateByIds: boolean;
  canHydrateByQuery: boolean;
}) {
  if (canHydrateByIds) return "ids" as const;
  return canHydrateByQuery ? ("query" as const) : null;
}

/** Everything the fetch needs to decide: what resource, how to fetch it, and with what
 *  ids/query — resolved once from the command + digest so the hook body is a straight
 *  read of the result. */
function resolveHydrationInputs({
  command,
  digest,
  maxRows,
}: Pick<CapabilityDataInput, "command" | "digest"> & { maxRows: number }) {
  const resource = digest?.resource ?? command?.resource ?? null;
  const hydrator = resource ? CAPABILITY_HYDRATORS[resource] : undefined;

  // The ids the settled result named — only the rows the card will draw.
  // Sub-entity reads (`dataset records`, `prompt versions`) carry ids that do
  // NOT name the resource itself; resolving them as if they did would misread
  // "record not found as a dataset" as "dataset gone" — so they stay on the
  // stored-structure rendering.
  const idsEligible = digest?.strategy === "id-ref" && !CLI_SUBRESOURCE_VERBS.has(digest.verb);
  const ids =
    idsEligible && digest?.ids && digest.ids.length > 0 ? digest.ids.slice(0, maxRows) : null;
  // Query-fetch is for BEFORE the result exists (start frame) and for
  // aggregates that re-run by design (`query-ref`). A settled reduced/text
  // result must NOT be silently re-run: fresh rows could contradict the
  // answer the agent actually gave, and the stored output is the honest view.
  const queryEligible = digest == null || digest.strategy === "query-ref";
  const query = queryEligible ? (digest?.query ?? command?.query ?? null) : null;

  const canHydrateByIds = Boolean(ids && hydrator?.byIds);
  const canHydrateByQuery = Boolean(query && hydrator?.byQuery);
  const mode = hydrationMode({ canHydrateByIds, canHydrateByQuery });

  return { resource, hydrator, ids, query, mode };
}

/** The actual fetch, once `mode` has already picked which strategy applies. */
async function fetchCapabilityRows({
  mode,
  hydrator,
  utils,
  projectId,
  ids,
  query,
  maxRows,
}: {
  mode: "ids" | "query";
  hydrator: CapabilityHydrator | undefined;
  utils: Parameters<NonNullable<CapabilityHydrator["byIds"]>>[0]["utils"];
  projectId: string;
  ids: string[] | null;
  query: Record<string, unknown> | null;
  maxRows: number;
}): Promise<CapabilityHydration> {
  if (mode === "ids") {
    return hydrator!.byIds!({ utils, projectId, ids: ids! });
  }
  return hydrator!.byQuery!({ utils, projectId, query: query!, limit: maxRows });
}

/** The card's data, read off the query's settled/loading/error state. */
function buildCapabilityData(
  result: { data: CapabilityHydration | undefined; isError: boolean; isFetching: boolean },
  digest: CliResultDigest | null | undefined,
): CapabilityData {
  const hydration = result.data;
  const totalCount = digest?.counts?.total ?? hydration?.total ?? null;

  if (result.isError) {
    return { status: "unavailable", rows: [], loadedCount: 0, totalCount, isHydrating: false };
  }
  if (!hydration) {
    return { status: "hydrating", rows: [], loadedCount: 0, totalCount, isHydrating: true };
  }
  return {
    status: "hydrated",
    rows: hydration.rows,
    loadedCount: hydration.rows.length,
    totalCount,
    // Still true while a superseded fetch's rows are shown and the refined
    // fetch (new key, keepPreviousData) is in flight.
    isHydrating: result.isFetching,
  };
}

export function useCapabilityData({
  command,
  digest,
  maxRows = DEFAULT_MAX_ROWS,
}: CapabilityDataInput): CapabilityData {
  const utils = api.useUtils();
  // The viewer's CURRENT project, from the one authoritative context — never a
  // prop, so a card can't be handed some other project's id and quietly break
  // isolation. (The procedures re-check permissions server-side regardless.)
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;

  const { resource, hydrator, ids, query, mode } = resolveHydrationInputs({
    command,
    digest,
    maxRows,
  });

  const enabled = projectId !== null && mode !== null;

  const result = useQuery({
    queryKey: ["langy-capability-data", projectId, resource, mode, mode === "ids" ? ids : query],
    queryFn: () =>
      fetchCapabilityRows({
        mode: mode!,
        hydrator,
        utils,
        projectId: projectId!,
        ids,
        query,
        maxRows,
      }),
    enabled,
    staleTime: 30_000,
    retry: 1,
    // Reconcile, don't blink: when the digest lands and the key flips from the
    // query fetch to the ids fetch, the query rows stay on screen until the
    // refined rows arrive.
    placeholderData: keepPreviousData,
  });

  if (!enabled) return IDLE;

  return buildCapabilityData(result, digest);
}
