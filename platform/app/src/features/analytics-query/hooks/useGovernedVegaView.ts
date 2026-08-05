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
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import embed, { type EmbedOptions, type Result } from "vega-embed";

import {
  buildGovernedVegaSpec,
  type GovernedVegaSpecBuild,
} from "../visualization/buildGovernedVegaSpec";
import { governedRenderFailure } from "../visualization/governedChartFailures";
import type {
  GovernedVegaColorMode,
  GovernedVegaConfig,
} from "../visualization/langwatchVegaConfig";
import { createNoNetworkVegaLoader } from "../visualization/noNetworkVegaLoader";
import type {
  GovernedDataset,
  VegaValidationError,
} from "../visualization/visualization.types";

export type GovernedVegaViewStatus = "idle" | "embedding" | "ready" | "failed";

export interface GovernedVegaViewState {
  readonly status: GovernedVegaViewStatus;
  /** Set only in the `failed` status, and never silently swallowed. */
  readonly failure: VegaValidationError | null;
}

export interface UseGovernedVegaViewInput {
  /**
   * The specification `validateVegaLiteSpec` accepted. Its identity is what
   * decides a re-embed, so the caller memoizes it.
   */
  readonly spec: unknown;
  /** Rows by registered dataset name. A new object means new rows to push. */
  readonly datasets: Readonly<Record<string, GovernedDataset>>;
  /** The LangWatch theme, handed to the runtime as its base configuration. */
  readonly themeConfig: GovernedVegaConfig;
  /** The configuration values the specification may not override. */
  readonly pinnedConfig: GovernedVegaConfig;
  readonly colorMode: GovernedVegaColorMode;
  /**
   * False while there is nothing to draw — before validation passes, or after
   * it fails. A view already mounted is finalized when this goes false.
   */
  readonly enabled: boolean;
}

export interface UseGovernedVegaViewResult {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly state: GovernedVegaViewState;
}

const IDLE: GovernedVegaViewState = { status: "idle", failure: null };
const EMBEDDING: GovernedVegaViewState = { status: "embedding", failure: null };
const READY: GovernedVegaViewState = { status: "ready", failure: null };

/**
 * The options the chart runtime is given. Exported because they are a contract
 * rather than a detail: `actions: false` is what keeps the export and
 * open-in-editor menu off a governed chart, `ast: true` is what makes Vega
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
export function governedVegaEmbedOptions({
  themeConfig,
  colorMode,
}: {
  themeConfig: GovernedVegaConfig;
  colorMode: GovernedVegaColorMode;
}): EmbedOptions {
  return {
    actions: false,
    renderer: "svg",
    ast: true,
    loader: createNoNetworkVegaLoader() as EmbedOptions["loader"],
    config: themeConfig as EmbedOptions["config"],
    tooltip: { theme: colorMode },
  };
}

export function useGovernedVegaView({
  spec,
  datasets,
  themeConfig,
  pinnedConfig,
  colorMode,
  enabled,
}: UseGovernedVegaViewInput): UseGovernedVegaViewResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<Result | null>(null);
  const buildRef = useRef<GovernedVegaSpecBuild | null>(null);
  /**
   * The datasets the running view already holds. Compared by identity, so the
   * push that would immediately follow an embed is skipped rather than run.
   */
  const loadedDatasetsRef = useRef<UseGovernedVegaViewInput["datasets"] | null>(
    null,
  );
  /** Latest rows, for the embed effect, which must not re-run when they move. */
  const datasetsRef = useRef(datasets);
  datasetsRef.current = datasets;

  const [state, setState] = useState<GovernedVegaViewState>(IDLE);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) {
      setState(IDLE);
      return;
    }

    let abandoned = false;
    setState(EMBEDDING);

    const build = buildGovernedVegaSpec({
      spec,
      datasets: datasetsRef.current,
      pinnedConfig,
    });
    buildRef.current = build;
    const embedded = datasetsRef.current;

    void embed(
      container,
      build.spec as Parameters<typeof embed>[1],
      governedVegaEmbedOptions({ themeConfig, colorMode }),
    )
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
        setState({ status: "failed", failure: governedRenderFailure(error) });
      });

    return () => {
      abandoned = true;
      resultRef.current?.finalize();
      resultRef.current = null;
      loadedDatasetsRef.current = null;
    };
  }, [spec, themeConfig, pinnedConfig, colorMode, enabled]);

  useEffect(() => {
    const result = resultRef.current;
    const build = buildRef.current;
    if (state.status !== "ready" || result === null || build === null) return;
    if (loadedDatasetsRef.current === datasets) return;
    loadedDatasetsRef.current = datasets;

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
  }, [datasets, state.status]);

  useEffect(() => {
    const container = containerRef.current;
    if (state.status !== "ready" || container === null) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const result = resultRef.current;
      if (result === null) return;
      void result.view.resize().runAsync();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [state.status]);

  return { containerRef, state };
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
  setState: (state: GovernedVegaViewState) => void;
  error: unknown;
}): void {
  result.finalize();
  if (resultRef.current === result) resultRef.current = null;
  setState({ status: "failed", failure: governedRenderFailure(error) });
}
