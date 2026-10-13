import { reloadingWriteOptions } from "@langwatch/browser-host/errors";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { useEffect, useRef } from "react";

import { useViewStore } from "../../../behavior/explorer.store.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { type LensConfig, setLensSyncBridge } from "../../../behavior/view.slice.ts";

/** Discriminator stored on each SavedView row so the traces v2 lens
 * persistence doesn't collide with the v1 filter views — rows left behind by
 * the removed legacy Traces page, and still written by Analytics. Mirrored
 * server-side in `saved-view.service.ts`. */
const KIND = "v2-traces-lens";

/**
 * Shape we serialise the LensConfig into when it lives in the SavedView row's `filters`
 * JSON column. Kept as its own concrete type so the decode round-trips and won't
 * silently break if we add fields to LensConfig — TypeScript will warn at the encoder.
 */
interface SerializedLens {
  [key: string]: unknown;
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

function decode(id: string, name: string, filters: unknown): LensConfig | null {
  if (!filters || typeof filters !== "object") return null;
  const f = filters as Partial<SerializedLens>;
  const columns = f.columns;
  const addons = f.addons;
  const hasColumnAndAddonLists = Array.isArray(columns) && Array.isArray(addons);
  if (!hasColumnAndAddonLists) return null;
  if (!f.sort || typeof f.sort !== "object") return null;
  return {
    id,
    name,
    isBuiltIn: false,
    columns,
    addons,
    grouping: f.grouping ?? "flat",
    sort: f.sort,
    filterText: typeof f.filterText === "string" ? f.filterText : "",
  };
}

function decodeLenses(
  rows: readonly { id: string; name: string; filters: unknown }[],
): LensConfig[] {
  const lenses: LensConfig[] = [];
  for (const row of rows) {
    const decoded = decode(row.id, row.name, row.filters);
    if (decoded) lenses.push(decoded);
  }
  return lenses;
}

/**
 * The lens writes the bridge mirrors to the server; each reloads the strip once settled.
 * A refused create is taken back via `discardRefusedLens`: an empty list reloaded as
 * empty keeps its reference, so the hydrate effect would not re-run.
 */
function useLensWriteMutations(projectId: string | undefined) {
  const utils = api.useUtils();
  const discardRefusedLens = useViewStore((s) => s.discardRefusedLens);
  // New lens id -> the lens to return to if the server refuses it.
  const fallbackLensIdsRef = useRef(new Map<string, string>());
  const reloadLenses = () => {
    if (projectId) {
      void utils.savedViews.getAll.invalidate({ projectId, kind: KIND });
    }
  };
  const lensWriteOptions = (fallbackTitle: string) =>
    reloadingWriteOptions({ fallbackTitle, reload: reloadLenses });
  const createOptions = lensWriteOptions("Couldn't save the lens");

  const createMutation = api.savedViews.create.useMutation({
    onSuccess: createOptions.onSuccess,
    onError: (error, { id: lensId }) => {
      const fallbackLensId = lensId && fallbackLensIdsRef.current.get(lensId);
      if (lensId && fallbackLensId) {
        discardRefusedLens({ lensId, fallbackLensId });
      }
      createOptions.onError(error);
    },
    onSettled: (_data, _error, { id: lensId }) => {
      if (lensId) fallbackLensIdsRef.current.delete(lensId);
    },
  });

  return {
    createLens: (
      input: Parameters<typeof createMutation.mutate>[0] & { id: string },
      fallbackLensId: string,
    ) => {
      fallbackLensIdsRef.current.set(input.id, fallbackLensId);
      createMutation.mutate(input);
    },
    renameMutation: api.savedViews.rename.useMutation(lensWriteOptions("Couldn't rename the lens")),
    deleteMutation: api.savedViews.delete.useMutation(lensWriteOptions("Couldn't delete the lens")),
  };
}

/**
 * Wires the lens viewStore to the server-side SavedView table; call once at the top of
 * TracesPage. Hydrates the user lenses and registers a sync bridge that mirrors lens
 * writes to the server and tells the store when the project (an aggregate) takes none.
 */
export function useLensSync(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const lensesQuery = api.savedViews.getAll.useQuery(
    { projectId: projectId ?? "", kind: KIND },
    {
      enabled: !!projectId,
    },
  );

  const { createLens, renameMutation, deleteMutation } = useLensWriteMutations(projectId);

  // Refs so the bridge closures stay stable across renders — `set...Bridge`
  // is called once on mount, but the mutate functions identity changes
  // every render, which would otherwise force us to re-register.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const canSaveLenses = !isAggregateProjectKind(project?.kind);
  const canSaveLensesRef = useRef(canSaveLenses);
  canSaveLensesRef.current = canSaveLenses;
  const createRef = useRef(createLens);
  createRef.current = createLens;
  const renameRef = useRef(renameMutation.mutate);
  renameRef.current = renameMutation.mutate;
  const deleteRef = useRef(deleteMutation.mutate);
  deleteRef.current = deleteMutation.mutate;

  // Register the bridge once. The store calls these whenever the local
  // mutators fire, so create/rename/delete on a lens tab gets mirrored
  // to the server without each call site knowing about tRPC.
  useEffect(() => {
    setLensSyncBridge({
      acceptsWrites: () => canSaveLensesRef.current,
      create: (lens, { fallbackLensId }) => {
        const pid = projectIdRef.current;
        if (!pid) return;
        createRef.current(
          {
            projectId: pid,
            // Client-generated id keeps the locally-active lens valid
            // through the server refetch — without it, the server would
            // mint a new nanoid and `setUserLenses` would orphan the
            // local active id.
            id: lens.id,
            name: lens.name,
            filters: encode(lens),
            kind: KIND,
            scope: "project",
          },
          fallbackLensId,
        );
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
    setUserLenses(decodeLenses(rows));
  }, [lensesQuery.data, setUserLenses]);
}
