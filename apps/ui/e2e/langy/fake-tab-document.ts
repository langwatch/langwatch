/**
 * The fake workbench tab's document half: reads the saved row into the
 * store and writes it back the way the page's autosave does. See
 * `fake-workbench-tab.ts` for which parts of the page this stands in for.
 */
import { useEvaluationsV3Store } from "@langwatch/experiment-browser/workbench-store";
import { extractPersistedState } from "@langwatch/experiment-contract";
import {
  LangyUiPageOutOfDateError,
  LangyUiSaveFailedError,
} from "@langwatch/langy-browser/langy-ui-actions";

import { CONFIG } from "./config";
import { trpcMutate, trpcQuery } from "./trpc";

/** What one save did, in the page's own vocabulary. */
export type SaveOutcome = "saved" | "unchanged" | "refused" | "failed";

/** The document half of one open tab. */
export interface FakeTabDocument {
  /** Read the saved row into the store, the way the page's load boundary does. */
  load: () => Promise<void>;
  /** Write the store back, answering with what the write did. */
  saveNow: () => Promise<SaveOutcome>;
  /** Reload first when a write landed somewhere else. */
  catchUpIfBehind: () => Promise<void>;
  /** Throw when the server has already moved past this page. */
  assertPageIsCurrent: () => void;
  /** Save, and throw the page's own error when the save cannot happen. */
  saveOrRefuse: () => Promise<void>;
}

function lacksSavableExperiment(experimentId: string | null | undefined, name: string): boolean {
  return !experimentId || !name;
}

function saveFailureOutcome(error: unknown, workbenchVersion: number | null): SaveOutcome {
  if (
    typeof error === "object" &&
    error !== null &&
    "domainErrorCode" in error &&
    error.domainErrorCode === "experiment_stale_workbench_state"
  ) {
    const meta =
      "domainErrorMeta" in error &&
      typeof error.domainErrorMeta === "object" &&
      error.domainErrorMeta !== null
        ? error.domainErrorMeta
        : null;
    const currentVersion = meta && "currentVersion" in meta ? meta.currentVersion : void 0;
    const actorLabel = meta && "actorLabel" in meta ? meta.actorLabel : void 0;
    useEvaluationsV3Store.getState().setStaleWorkbench({
      serverVersion:
        typeof currentVersion === "number" ? currentVersion : (workbenchVersion ?? 0) + 1,
      ...(typeof actorLabel === "string" ? { actorLabel } : {}),
    });
    return "refused";
  }
  console.log(`[fake-tab] save failed: ${String(error).slice(0, 300)}`);
  return "failed";
}

/** Whether `saveNow` can skip the write outright, and why (README.md "fake-tab-document.ts"). */
function saveNowSkipReason(state: {
  experimentId: string | null;
  name: string;
  staleWorkbench: boolean;
}): SaveOutcome | null {
  if (lacksSavableExperiment(state.experimentId, state.name)) return "unchanged";
  // Out of date against the server: saving now would clobber the newer
  // version, so this waits for a reload exactly as autosave does.
  if (state.staleWorkbench) return "refused";
  return null;
}

export function createFakeTabDocument({
  cookie,
  experimentSlug,
}: {
  cookie: string;
  experimentSlug: string;
}): FakeTabDocument {
  let lastSaved: string | null = null;

  const load = async (): Promise<void> => {
    const row = await trpcQuery<{
      id: string;
      slug: string;
      workbenchState: unknown;
      version: number;
    }>({
      cookie,
      path: "experiments.getEvaluationsV3BySlug",
      input: { projectId: CONFIG.PROJECT_ID, experimentSlug },
    });
    const store = useEvaluationsV3Store.getState();
    store.reset();
    // The real load boundary: it normalizes evaluators and targets, which is
    // also where a saved row carrying a comparison config its type cannot own
    // gets repaired. Reading the row any other way would read it differently
    // from the page.
    store.loadState(row.workbenchState);
    store.setExperimentId(row.id);
    store.setExperimentSlug(row.slug);
    store.setWorkbenchVersion(row.version);
    lastSaved = JSON.stringify(extractPersistedState(useEvaluationsV3Store.getState()));
  };

  /**
   * The page's `saveNow`, minus the debounce and the badge — every claimed
   * action saves before it answers, matching what `saveOrRefuse` guarantees
   * on the real page (the 1.5s autosave debounce there only covers typing).
   */
  const saveNow = async (): Promise<SaveOutcome> => {
    const state = useEvaluationsV3Store.getState();
    const skip = saveNowSkipReason(state);
    if (skip) return skip;

    const body = extractPersistedState(state);
    const snapshot = JSON.stringify(body);
    if (snapshot === lastSaved) return "unchanged";

    try {
      const saved = await trpcMutate<{ version: number }>({
        cookie,
        path: "experiments.saveEvaluationsV3",
        input: {
          projectId: CONFIG.PROJECT_ID,
          experimentId: state.experimentId,
          expectedVersion: state.workbenchVersion,
          state: body,
        },
        timeoutMs: 60_000,
      });
      useEvaluationsV3Store.getState().setWorkbenchVersion(saved.version);
      lastSaved = snapshot;
      return "saved";
    } catch (error) {
      return saveFailureOutcome(error, state.workbenchVersion);
    }
  };

  /**
   * Catches up with a write that landed elsewhere, the way
   * `useWorkbenchUpdateListener` does on the real page: no broadcast here,
   * but saving before every answer keeps between-actions always clean.
   */
  const catchUpIfBehind = async (): Promise<void> => {
    if (!useEvaluationsV3Store.getState().staleWorkbench) return;
    await load();
  };

  /**
   * A page the server has already moved past cannot write: autosave stands down
   * there by design, and answering "done" from that state would tell the agent
   * a document exists that only this tab can see.
   */
  const assertPageIsCurrent = () => {
    if (useEvaluationsV3Store.getState().staleWorkbench) {
      throw new LangyUiPageOutOfDateError();
    }
  };

  const saveOrRefuse = async () => {
    const outcome = await saveNow();
    if (outcome === "failed") throw new LangyUiSaveFailedError();
    assertPageIsCurrent();
    if (outcome === "refused") throw new LangyUiPageOutOfDateError();
  };

  return {
    load,
    saveNow,
    catchUpIfBehind,
    assertPageIsCurrent,
    saveOrRefuse,
  };
}
