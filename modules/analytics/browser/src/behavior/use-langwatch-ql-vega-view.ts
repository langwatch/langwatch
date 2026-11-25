/**
 * Created once, fed many times, always finalized: a spec change re-embeds,
 * a data change pushes rows into the running view (no Reload jank), and
 * every exit path calls `finalize()` — a dropped view leaks Vega's global listeners.
 */

import {
  buildLangWatchQLVegaSpec,
  type LangWatchQLVegaSpecBuild,
  lwqlRenderFailure,
  createNoNetworkVegaLoader,
  type LangWatchQLVegaColorMode,
  type LangWatchQLVegaConfig,
  type LangWatchQLDataset,
  type LangWatchQLChartCrashContext,
  type VegaValidationError,
} from "@langwatch/analytics-contract/visualization";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { toError } from "@langwatch/browser-host/errors";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import embed, { type EmbedOptions, type Result } from "vega-embed";

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
  /** The board and widget a failure to draw is reported with. */
  readonly crashContext?: LangWatchQLChartCrashContext;
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
 * `ast: true` makes Vega interpret expressions instead of compiling them with
 * `new Function`, which a CSP without `unsafe-eval` refuses. `expr` is deliberately
 * unset: `ast: true` already reaches its own interpreter, so passing one would duplicate it.
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
  crashContext,
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
  const fail = useReportedFailure({ setState, crashContext });

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
      fail,
      refs: { resultRef, buildRef, loadedDatasetsRef, datasetsRef },
    });
  }, [spec, themeConfig, pinnedConfig, colorMode, enabled, fail]);

  useEffect(() => {
    const result = resultRef.current;
    const build = buildRef.current;
    if (state.status !== "ready" || result === null || build === null) return;
    if (loadedDatasetsRef.current === datasets) return;
    loadedDatasetsRef.current = datasets;

    pushDatasetsIntoView({ result, build, datasets, resultRef, fail });
  }, [datasets, state.status, fail]);

  useEffect(() => {
    const container = containerRef.current;
    if (state.status !== "ready" || container === null) return;
    if (typeof ResizeObserver === "undefined") return;

    return observeContainerResize({ container, resultRef, fail });
  }, [state.status, fail]);

  return { containerRef, state };
}

/**
 * Ends the view in `failed` and reports the failure as an exception, once per distinct failure
 * while the chart is mounted. A blocked loader is the spec's own refusal, so it is not reported.
 */
function useReportedFailure({
  setState,
  crashContext,
}: {
  setState: (state: LangWatchQLVegaViewState) => void;
  crashContext: LangWatchQLChartCrashContext | undefined;
}): (error: unknown) => void {
  const analytics = useUiAnalytics();
  // Refs keep the failure handler stable, so a new context never re-embeds the view.
  const reporting = useRef({ analytics, crashContext });
  const reported = useRef(new Set<string>());

  useEffect(() => {
    reporting.current = { analytics, crashContext };
  });

  return useCallback(
    (error: unknown) => {
      const failure = lwqlRenderFailure(error);
      setState({ status: "failed", failure });
      // The contract words every non-Error alike, so the thrown message is the identity.
      const err = toError(error);
      if (failure.rule === "loader.blocked" || reported.current.has(err.message)) return;
      reported.current.add(err.message);
      reporting.current.analytics.captureException({
        error: err,
        properties: { surface: "lwql_chart_embed", ...reporting.current.crashContext },
      });
    },
    [setState],
  );
}

/** A resized container re-runs the view; a failure there ends it like any other. */
function observeContainerResize({
  container,
  resultRef,
  fail,
}: {
  container: HTMLDivElement;
  resultRef: RefObject<Result | null>;
  fail: (error: unknown) => void;
}): () => void {
  const observer = new ResizeObserver(() => {
    const result = resultRef.current;
    if (result === null) return;

    void result.view
      .resize()
      .runAsync()
      .catch((error: unknown) => {
        finalizeInto({ result, resultRef, fail, error });
      });
  });
  observer.observe(container);

  return () => observer.disconnect();
}

/** The mutable handles the effects share: one running view, and what it holds. */
interface LangWatchQLVegaViewRefs {
  readonly resultRef: RefObject<Result | null>;
  readonly buildRef: RefObject<LangWatchQLVegaSpecBuild | null>;
  readonly loadedDatasetsRef: RefObject<LangWatchQLVegaDatasets | null>;
  readonly datasetsRef: RefObject<LangWatchQLVegaDatasets>;
}

/**
 * Puts a view in the container and hands back its teardown. The abandoned
 * flag makes a teardown that lands mid-embed safe: the promise still
 * settles, and the view it settles with is finalized on the spot.
 */
function embedLangWatchQLVegaView({
  container,
  spec,
  themeConfig,
  pinnedConfig,
  colorMode,
  setState,
  fail,
  refs,
}: {
  container: HTMLDivElement;
  spec: unknown;
  themeConfig: LangWatchQLVegaConfig;
  pinnedConfig: LangWatchQLVegaConfig;
  colorMode: LangWatchQLVegaColorMode;
  setState: (state: LangWatchQLVegaViewState) => void;
  fail: (error: unknown) => void;
  refs: LangWatchQLVegaViewRefs;
}): () => void {
  const { resultRef, buildRef, loadedDatasetsRef, datasetsRef } = refs;
  let abandoned = false;
  setState(EMBEDDING);

  // Guarded for the same reason `pushDatasetsIntoView` does: a throw here is
  // synchronous and escapes before `embed`'s rejection handler exists, leaving
  // the view stuck in `EMBEDDING`. The spec is caller-authored, not ours to trust.
  let build: LangWatchQLVegaSpecBuild;
  try {
    build = buildLangWatchQLVegaSpec({
      spec,
      datasets: datasetsRef.current,
      pinnedConfig,
    });
  } catch (error) {
    fail(error);
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
      fail(error);
    });

  return () => {
    abandoned = true;
    resultRef.current?.finalize();
    resultRef.current = null;
    loadedDatasetsRef.current = null;
  };
}

/**
 * Feeds new rows to a view that is already running. A throw from the
 * update and a rejected run end the same way, since a view that failed
 * part-way through new data is in an unknown state either way.
 */
function pushDatasetsIntoView({
  result,
  build,
  datasets,
  resultRef,
  fail,
}: {
  result: Result;
  build: LangWatchQLVegaSpecBuild;
  datasets: LangWatchQLVegaDatasets;
  resultRef: RefObject<Result | null>;
  fail: (error: unknown) => void;
}): void {
  try {
    for (const name of build.datasetNames) {
      result.view.data(name, [...(datasets[name] ?? [])]);
    }
    void result.view.runAsync().catch((error: unknown) => {
      finalizeInto({ result, resultRef, fail, error });
    });
  } catch (error: unknown) {
    finalizeInto({ result, resultRef, fail, error });
  }
}

/**
 * A view that has failed is finalized rather than left running: it is already
 * in an unknown state, and a half-live view still holds Vega's global handlers.
 */
function finalizeInto({
  result,
  resultRef,
  fail,
  error,
}: {
  result: Result;
  resultRef: RefObject<Result | null>;
  fail: (error: unknown) => void;
  error: unknown;
}): void {
  result.finalize();
  if (resultRef.current === result) resultRef.current = null;
  fail(error);
}
