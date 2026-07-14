/**
 * useCapabilityData — the ONE hydration seam between a capability card and the
 * product's own API.
 *
 * A card hands this hook what it knows and gets back current rows fetched with
 * the viewer's session. What it knows grows over the call's life, and the hook
 * is PROGRESSIVE across that growth:
 *
 *   START frame   only the parsed command exists (`command`). Where the
 *                 resource's hydrator supports query-fetch (traces), rows are
 *                 fetched immediately — on screen while the agent still works.
 *   END frame     the digest arrives (ids + counts). An id-ref digest refines
 *                 the fetch to exactly the surfaced ids; the previous query
 *                 rows stay visible while the refined fetch is in flight
 *                 (keepPreviousData), so the card fills in, never blinks.
 *
 * The return shape is built for CHUNKED fill: `rows` grows, and
 * `loadedCount` / `totalCount` give the card a real progress fraction. Today
 * ids resolve in a single batch (capped at the rows the card draws); batching
 * into smaller requests changes only this hook, never card code.
 *
 * Never JSX, never a render decision — state only. A resource with no
 * hydrator, a call with nothing to fetch by, or a missing project all resolve
 * to `idle`, and the card falls back to its stored-output path.
 */
import { useQuery } from "@tanstack/react-query";
import {
  CLI_SUBRESOURCE_VERBS,
  type CliResultDigest,
} from "@langwatch/cli-cards";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  CAPABILITY_HYDRATORS,
  type CapabilityHydratedRow,
} from "../components/capabilities/capabilityHydrators";
import type { CapabilityCommand } from "../logic/langyCapabilityDigest";

/** How many rows a card draws, and therefore how many this hook hydrates. */
const DEFAULT_MAX_ROWS = 5;

export type CapabilityDataStatus =
  | "idle"
  | "hydrating"
  | "hydrated"
  | "unavailable";

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

export function useCapabilityData({
  command,
  digest,
  maxRows = DEFAULT_MAX_ROWS,
}: CapabilityDataInput): CapabilityData {
  const utils = api.useContext();
  // The viewer's CURRENT project, from the one authoritative context — never a
  // prop, so a card can't be handed some other project's id and quietly break
  // isolation. (The procedures re-check permissions server-side regardless.)
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? null;

  const resource = digest?.resource ?? command?.resource ?? null;
  const hydrator = resource ? CAPABILITY_HYDRATORS[resource] : undefined;

  // The ids the settled result named — only the rows the card will draw.
  // Sub-entity reads (`dataset records`, `prompt versions`) carry ids that do
  // NOT name the resource itself; resolving them as if they did would misread
  // "record not found as a dataset" as "dataset gone" — so they stay on the
  // stored-structure rendering.
  const idsEligible =
    digest?.strategy === "id-ref" && !CLI_SUBRESOURCE_VERBS.has(digest.verb);
  const ids =
    idsEligible && digest?.ids && digest.ids.length > 0
      ? digest.ids.slice(0, maxRows)
      : null;
  // Query-fetch is for BEFORE the result exists (start frame) and for
  // aggregates that re-run by design (`query-ref`). A settled reduced/text
  // result must NOT be silently re-run: fresh rows could contradict the
  // answer the agent actually gave, and the stored output is the honest view.
  const queryEligible = digest == null || digest.strategy === "query-ref";
  const query = queryEligible
    ? (digest?.query ?? command?.query ?? null)
    : null;

  const mode =
    ids && hydrator?.byIds
      ? ("ids" as const)
      : query && hydrator?.byQuery
        ? ("query" as const)
        : null;

  const enabled = projectId !== null && mode !== null;

  const result = useQuery({
    queryKey: [
      "langy-capability-data",
      projectId,
      resource,
      mode,
      mode === "ids" ? ids : query,
    ],
    queryFn: async () => {
      if (mode === "ids") {
        return hydrator!.byIds!({ utils, projectId: projectId!, ids: ids! });
      }
      return hydrator!.byQuery!({
        utils,
        projectId: projectId!,
        query: query!,
        limit: maxRows,
      });
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
    // Reconcile, don't blink: when the digest lands and the key flips from the
    // query fetch to the ids fetch, the query rows stay on screen until the
    // refined rows arrive.
    keepPreviousData: true,
  });

  if (!enabled) return IDLE;

  const hydration = result.data;
  const totalCount =
    digest?.counts?.total ?? hydration?.total ?? null;

  if (result.isError) {
    return {
      status: "unavailable",
      rows: [],
      loadedCount: 0,
      totalCount,
      isHydrating: false,
    };
  }
  if (!hydration) {
    return {
      status: "hydrating",
      rows: [],
      loadedCount: 0,
      totalCount,
      isHydrating: true,
    };
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
