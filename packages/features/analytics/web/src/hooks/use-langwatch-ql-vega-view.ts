/**
 * The Vega view's whole life: created once, fed many times, always finalized.
 *
 * The distinction this hook exists to hold is between a specification change
 * and a data change. Rebuilding the view when only the rows moved would throw
 * away every scale, every transition, and every bit of interaction state on
 * each Reload — so new rows go into the *running* view through
 * `view.data(name, rows)`, and only a new specification, a new theme, or a new
 * colour mode causes a re-embed.
 *
 * Everything that can end a view ends it the same way, through `finalize()`:
 * unmount, a specification the policy refused, and a runtime failure. Vega
 * registers global listeners and timers of its own, so a view that is dropped
 * without being finalized is a leak that outlives the page it was on.
 *
 * This module is where `vega-embed` — and therefore the whole Vega runtime —
 * is imported. It is reached only from the lazily loaded chart component, which
 * is what keeps Vega out of every other route's bundle.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import embed, { type EmbedOptions, type Result } from "vega-embed";

import {
  buildLangWatchQLVegaSpec,
  type LangWatchQLVegaSpecBuild,
} from "../visualization/build-langwatch-ql-vega-spec";
import type {
  LangWatchQLVegaColorMode,
  LangWatchQLVegaConfig,
} from "../visualization/langwatch-vega-config";
import { lwqlRenderFailure } from "../visualization/lwql-chart-failures";
import { createNoNetworkVegaLoader } from "../visualization/no-network-vega-loader";
import type {
  LangWatchQLDataset,
  VegaValidationError,
} from "../visualization/visualization-types";

export type LangWatchQLVegaViewStatus = "idle" | "embedding" | "ready" | "failed";

export interface LangWatchQLVegaViewState {
  readonly status: LangWatchQLVegaViewStatus;
  /** Set only in the `failed` status, and never silently swallowed. */
  readonly failure: VegaValidationError | null;
}

export interface UseLangWatchQLVegaViewInput {
  /**
   * The specification `validateVegaLiteSpec` accepted. Its identity is what
   * decides a re-embed, so the caller memoizes it.
   */
  readonly spec: unknown;
  /** Rows by registered dataset name. A new object means new rows to push. */
  readonly datasets: Readonly<Record<string, LangWatchQLDataset>>;
  /** The LangWatch theme, handed to the runtime as its base configuration. */
  readonly themeConfig: LangWatchQLVegaConfig;
  /** The configuration values the specification may not override. */
  readonly pinnedConfig: LangWatchQLVegaConfig;
  readonly colorMode: LangWatchQLVegaColorMode;
  /**
   * False while there is nothing to draw — before validation passes, or after
   * it fails. A view already mounted is finalized when this goes false.
   */
  readonly enabled: boolean;
}

export interface UseLangWatchQLVegaViewResult {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly state: LangWatchQLVegaViewState;
}

/** Rows by registered dataset name, as the view holds them. */
type LangWatchQLVegaDatasets = UseLangWatchQLVegaViewInput["datasets"];

const IDLE: LangWatchQLVegaViewState = { status: "idle", failure: null };
const EMBEDDING: LangWatchQLVegaViewState = {
  status: "embedding",
  failure: null,
};
const READY: LangWatchQLVegaViewState = { status: "ready", failure: null };

/**
 * The options the chart runtime is given. Exported because they are a contract
 * rather than a detail: `actions: false` is what keeps the export and
 * open-in-editor menu off a LangWatchQL chart, `ast: true` is what makes Vega
 * interpret expressions instead of compiling them with `new Function` (which a
 * Content-Security-Policy without `unsafe-eval` refuses), and `loader` is the
 * repository-owned loader that refuses every network and file read.
 *
 * `expr` is deliberately not set. `vega-embed@7` resolves the interpreter as
 * `vega.expressionInterpreter ?? opts.expr ?? <its own vega-interpreter>`, and
 * `vega@6` exports no `expressionInterpreter`, so `ast: true` already reaches
 * the interpreter vega-embed depends on directly. Passing our own would add a
 * second copy of it to the bundle to change nothing.
 */
export function lwqlVegaEmbedOptions({
  themeConfig,
  colorMode,
}: {
  themeConfig: LangWatchQLVegaConfig;
  colorMode: LangWatchQLVegaColorMode;
}): EmbedOptions {
  return {
    actions: false,
    renderer: "svg",
    ast: true,
    loader: createNoNetworkVegaLoader(),
    config: themeConfig,
    tooltip: { theme: colorMode },
  };
}

export function useLangWatchQLVegaView({
  spec,
  datasets,
  themeConfig,
  pinnedConfig,
  colorMode,
  enabled,
}: UseLangWatchQLVegaViewInput): UseLangWatchQLVegaViewResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<Result | null>(null);
  const buildRef = useRef<LangWatchQLVegaSpecBuild | null>(null);
  /**
   * The datasets the running view already holds. Compared by identity, so the
   * push that would immediately follow an embed is skipped rather than run.
   */
  const loadedDatasetsRef = useRef<LangWatchQLVegaDatasets | null>(null);
  /** Latest rows, for the embed effect, which must not re-run when they move. */
  const datasetsRef = useRef(datasets);
  datasetsRef.current = datasets;

  const [state, setState] = useState<LangWatchQLVegaViewState>(IDLE);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) {
      setState(IDLE);
      return;
    }

    return embedLangWatchQLVegaView({
      container,
      spec,
      themeConfig,
      pinnedConfig,
      colorMode,
      setState,
      refs: { resultRef, buildRef, loadedDatasetsRef, datasetsRef },
    });
  }, [spec, themeConfig, pinnedConfig, colorMode, enabled]);

  useEffect(() => {
    const result = resultRef.current;
    const build = buildRef.current;
    if (state.status !== "ready" || result === null || build === null) return;
    if (loadedDatasetsRef.current === datasets) return;
    loadedDatasetsRef.current = datasets;

    pushDatasetsIntoView({ result, build, datasets, resultRef, setState });
  }, [datasets, state.status]);

  useEffect(() => {
    const container = containerRef.current;
    if (state.status !== "ready" || container === null) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const result = resultRef.current;
      if (result === null) return;
      void result.view
        .resize()
        .runAsync()
        .catch((error: unknown) => {
          finalizeInto({ result, resultRef, setState, error });
        });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [state.status]);

  return { containerRef, state };
}

/** The mutable handles the effects share: one running view, and what it holds. */
interface LangWatchQLVegaViewRefs {
  readonly resultRef: RefObject<Result | null>;
  readonly buildRef: RefObject<LangWatchQLVegaSpecBuild | null>;
  readonly loadedDatasetsRef: RefObject<LangWatchQLVegaDatasets | null>;
  readonly datasetsRef: RefObject<LangWatchQLVegaDatasets>;
}

/**
 * Puts a view in the container and hands back the teardown for it.
 *
 * The abandoned flag is what makes a teardown that lands mid-embed safe: the
 * promise still settles, and the view it settles with is finalized on the spot
 * rather than left running with nothing pointing at it.
 */
function embedLangWatchQLVegaView({
  container,
  spec,
  themeConfig,
  pinnedConfig,
  colorMode,
  setState,
  refs,
}: {
  container: HTMLDivElement;
  spec: unknown;
  themeConfig: LangWatchQLVegaConfig;
  pinnedConfig: LangWatchQLVegaConfig;
  colorMode: LangWatchQLVegaColorMode;
  setState: (state: LangWatchQLVegaViewState) => void;
  refs: LangWatchQLVegaViewRefs;
}): () => void {
  const { resultRef, buildRef, loadedDatasetsRef, datasetsRef } = refs;
  let abandoned = false;
  setState(EMBEDDING);

  // Guarded for the same reason `pushDatasetsIntoView` guards its own build: a
  // throw here is synchronous, so it escapes before `embed`'s rejection
  // handler exists and leaves the view stuck in `EMBEDDING` — a blank chart
  // with no failure on screen, which is exactly the state this module says it
  // never produces. The spec is caller-authored, so the input is not ours to
  // trust even though no current path throws.
  let build: LangWatchQLVegaSpecBuild;
  try {
    build = buildLangWatchQLVegaSpec({
      spec,
      datasets: datasetsRef.current,
      pinnedConfig,
    });
  } catch (error) {
    setState({ status: "failed", failure: lwqlRenderFailure(error) });
    return () => {
      abandoned = true;
    };
  }
  buildRef.current = build;
  const embedded = datasetsRef.current;

  void embed(container, build.spec, lwqlVegaEmbedOptions({ themeConfig, colorMode }))
    .then((result) => {
      if (abandoned) {
        result.finalize();
        return;
      }
      resultRef.current = result;
      loadedDatasetsRef.current = embedded;
      setState(READY);
    })
    .catch((error: unknown) => {
      if (abandoned) return;
      resultRef.current = null;
      setState({ status: "failed", failure: lwqlRenderFailure(error) });
    });

  return () => {
    abandoned = true;
    resultRef.current?.finalize();
    resultRef.current = null;
    loadedDatasetsRef.current = null;
  };
}

/**
 * Feeds new rows to a view that is already running.
 *
 * A throw from the update and a rejected run end the same way, because a view
 * that failed part-way through new data is in an unknown state either way.
 */
function pushDatasetsIntoView({
  result,
  build,
  datasets,
  resultRef,
  setState,
}: {
  result: Result;
  build: LangWatchQLVegaSpecBuild;
  datasets: LangWatchQLVegaDatasets;
  resultRef: RefObject<Result | null>;
  setState: (state: LangWatchQLVegaViewState) => void;
}): void {
  try {
    for (const name of build.datasetNames) {
      result.view.data(name, [...(datasets[name] ?? [])]);
    }
    void result.view.runAsync().catch((error: unknown) => {
      finalizeInto({ result, resultRef, setState, error });
    });
  } catch (error: unknown) {
    finalizeInto({ result, resultRef, setState, error });
  }
}

/**
 * A view that has failed is finalized rather than left running: it is already
 * in an unknown state, and a half-live view still holds Vega's global handlers.
 */
function finalizeInto({
  result,
  resultRef,
  setState,
  error,
}: {
  result: Result;
  resultRef: RefObject<Result | null>;
  setState: (state: LangWatchQLVegaViewState) => void;
  error: unknown;
}): void {
  result.finalize();
  if (resultRef.current === result) resultRef.current = null;
  setState({ status: "failed", failure: lwqlRenderFailure(error) });
}
