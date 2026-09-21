/**
 * The fake workbench tab's document half: reading the saved row into the store,
 * and writing it back the way the page's autosave does.
 *
 * Split out of `fake-workbench-tab.ts` so the tab's wiring stays readable; the
 * behaviour is the page's, and `fake-workbench-tab.ts` documents which parts of
 * the page are stood in for.
 */
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import {
  LangyUiPageOutOfDateError,
  LangyUiSaveFailedError,
} from "~/features/langy/uiActions/errors";
import { PROJECT_ID } from "./config";
import { type TrpcCallError, trpcMutate, trpcQuery } from "./trpc";

/** What one save did, in the page's own vocabulary. */
export type SaveOutcome = "saved" | "unchanged" | "refused" | "failed";

/** The document half of one open tab. */
export interface FakeTabDocument {
  /** Read the saved row into the store, the way the page's load boundary does. */
  load(): Promise<void>;
  /** Write the store back, answering with what the write did. */
  saveNow(): Promise<SaveOutcome>;
  /** Reload first when a write landed somewhere else. */
  catchUpIfBehind(): Promise<void>;
  /** Throw when the server has already moved past this page. */
  assertPageIsCurrent(): void;
  /** Save, and throw the page's own error when the save cannot happen. */
  saveOrRefuse(): Promise<void>;
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
      input: { projectId: PROJECT_ID, experimentSlug },
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
    lastSaved = JSON.stringify(
      extractPersistedState(useEvaluationsV3Store.getState()),
    );
  };

  /**
   * The page's `saveNow`, minus the debounce and the badge.
   *
   * Every claimed action saves before it answers, which is what `saveOrRefuse`
   * guarantees on the real page anyway: the 1.5s autosave debounce there only
   * covers typing.
   */
  const saveNow = async (): Promise<SaveOutcome> => {
    const state = useEvaluationsV3Store.getState();
    if (!state.experimentId || !state.name) return "unchanged";
    // Out of date against the server: saving now would clobber the newer
    // version, so this waits for a reload exactly as autosave does.
    if (state.staleWorkbench) return "refused";

    const body = extractPersistedState(state);
    const snapshot = JSON.stringify(body);
    if (snapshot === lastSaved) return "unchanged";

    try {
      const saved = await trpcMutate<{ version: number }>({
        cookie,
        path: "experiments.saveEvaluationsV3",
        input: {
          projectId: PROJECT_ID,
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
      const call = error as TrpcCallError;
      if (call.domainErrorCode === "experiment_stale_workbench_state") {
        const currentVersion = call.domainErrorMeta?.currentVersion;
        const actorLabel = call.domainErrorMeta?.actorLabel;
        useEvaluationsV3Store.getState().setStaleWorkbench({
          serverVersion:
            typeof currentVersion === "number"
              ? currentVersion
              : (state.workbenchVersion ?? 0) + 1,
          ...(typeof actorLabel === "string" ? { actorLabel } : {}),
        });
        return "refused";
      }
      console.log(`[fake-tab] save failed: ${String(error).slice(0, 300)}`);
      return "failed";
    }
  };

  /**
   * Catch up with a write that landed somewhere else, before touching anything.
   *
   * The real page does this through `useWorkbenchUpdateListener`: a workbench
   * with nothing unsaved reloads silently when someone else writes, and only a
   * page holding an unsaved edit banners instead. This tab has no broadcast to
   * listen to, but it saves before it answers every action, so BETWEEN actions
   * it is always the clean case, which is exactly the case that reloads.
   *
   * Without this, the first action the agent sent down the backend path left the
   * tab a version behind, and it then refused every later action for the rest of
   * the conversation. That is not what the customer's page does, and a suite
   * that reproduced it would be measuring the stand-in rather than the leg.
   *
   * The refusal itself is untouched: a save refused DURING an action still
   * refuses that action, because the tab is holding an unsaved edit right then.
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
