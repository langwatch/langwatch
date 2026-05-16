import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  type LensConfig,
  setLensSyncBridge,
  useViewStore,
} from "../stores/viewStore";

/** Discriminator stored on each SavedView row so the new traces v2 lens
 * persistence doesn't collide with the legacy /messages page filter
 * views. Mirrored server-side in `saved-view.service.ts`. */
const KIND = "v2-traces-lens";

/**
 * Shape we serialise the LensConfig into when it lives in the SavedView
 * row's `filters` JSON column. Kept as its own concrete type so the
 * decode round-trips and won't silently break if we add fields to
 * LensConfig — TypeScript will warn at the encoder.
 */
interface SerializedLens {
  v: 1;
  columns: string[];
  addons: string[];
  grouping: LensConfig["grouping"];
  sort: LensConfig["sort"];
  filterText: string;
}

function encode(lens: LensConfig): SerializedLens {
  return {
    v: 1,
    columns: lens.columns,
    addons: lens.addons,
    grouping: lens.grouping,
    sort: lens.sort,
    filterText: lens.filterText,
  };
}

function decode(
  id: string,
  name: string,
  filters: unknown,
): LensConfig | null {
  if (!filters || typeof filters !== "object") return null;
  const f = filters as Partial<SerializedLens>;
  if (!Array.isArray(f.columns) || !Array.isArray(f.addons)) return null;
  if (!f.sort || typeof f.sort !== "object") return null;
  return {
    id,
    name,
    isBuiltIn: false,
    columns: f.columns,
    addons: f.addons,
    grouping: f.grouping ?? "flat",
    sort: f.sort,
    filterText: typeof f.filterText === "string" ? f.filterText : "",
  };
}

/**
 * Wires the lens viewStore to the server-side SavedView table. Call
 * once at the top of TracesPage. The hook:
 *
 *  - Fetches `savedViews.getAll({ kind: "v2-traces-lens" })` and pushes
 *    the result into `viewStore.setUserLenses` so the lens strip
 *    reflects whatever the user / their team has saved on this project.
 *  - Registers a sync bridge so subsequent createLens / renameLens /
 *    deleteLens calls fire-and-forget the matching tRPC mutation —
 *    keeping the local store as a hot cache, the server as the source
 *    of truth.
 *
 * Built-in lenses stay code-defined; they're not persisted server-side.
 * Drafts (per-lens local tweaks) also stay local — they're the
 * "unsaved changes" state by definition.
 */
export function useLensSync(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const utils = api.useUtils();

  const lensesQuery = api.savedViews.getAll.useQuery(
    { projectId: projectId ?? "", kind: KIND },
    {
      enabled: !!projectId,
      // Lenses change rarely from the server's perspective and we mirror
      // every local mutation through the bridge, so a long stale time
      // avoids redundant refetches during a session.
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );

  const createMutation = api.savedViews.create.useMutation({
    onSuccess: () => {
      if (projectId) {
        void utils.savedViews.getAll.invalidate({ projectId, kind: KIND });
      }
    },
  });
  const renameMutation = api.savedViews.rename.useMutation({
    onSuccess: () => {
      if (projectId) {
        void utils.savedViews.getAll.invalidate({ projectId, kind: KIND });
      }
    },
  });
  const deleteMutation = api.savedViews.delete.useMutation({
    onSuccess: () => {
      if (projectId) {
        void utils.savedViews.getAll.invalidate({ projectId, kind: KIND });
      }
    },
  });

  // Refs so the bridge closures stay stable across renders — `set...Bridge`
  // is called once on mount, but the mutate functions identity changes
  // every render, which would otherwise force us to re-register.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const createRef = useRef(createMutation.mutate);
  createRef.current = createMutation.mutate;
  const renameRef = useRef(renameMutation.mutate);
  renameRef.current = renameMutation.mutate;
  const deleteRef = useRef(deleteMutation.mutate);
  deleteRef.current = deleteMutation.mutate;

  // Register the bridge once. The store calls these whenever the local
  // mutators fire, so create/rename/delete on a lens tab gets mirrored
  // to the server without each call site knowing about tRPC.
  useEffect(() => {
    setLensSyncBridge({
      create: (lens) => {
        const pid = projectIdRef.current;
        if (!pid) return;
        createRef.current({
          projectId: pid,
          // Client-generated id keeps the locally-active lens valid
          // through the server refetch — without it, the server would
          // mint a new nanoid and `setUserLenses` would orphan the
          // local active id.
          id: lens.id,
          name: lens.name,
          filters: encode(lens) as unknown as Record<string, unknown>,
          kind: KIND,
          scope: "project",
        });
      },
      rename: (lensId, name) => {
        const pid = projectIdRef.current;
        if (!pid) return;
        renameRef.current({ projectId: pid, viewId: lensId, name });
      },
      delete: (lensId) => {
        const pid = projectIdRef.current;
        if (!pid) return;
        deleteRef.current({ projectId: pid, viewId: lensId });
      },
    });
    return () => setLensSyncBridge(null);
  }, []);

  // Hydrate the store from server data. Fires once on initial query
  // resolution and on every subsequent refetch — `setUserLenses`
  // replaces the user-lens slice wholesale (preserves built-ins).
  const setUserLenses = useViewStore((s) => s.setUserLenses);
  useEffect(() => {
    const rows = lensesQuery.data;
    if (!rows) return;
    const lenses: LensConfig[] = [];
    for (const row of rows) {
      const decoded = decode(row.id, row.name, row.filters);
      if (decoded) lenses.push(decoded);
    }
    setUserLenses(lenses);
  }, [lensesQuery.data, setUserLenses]);
}
