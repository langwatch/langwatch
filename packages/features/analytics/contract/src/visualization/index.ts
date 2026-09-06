/**
 * The LangWatchQL chart model: the spec builder, the resolved theme contract,
 * the structural walkers, the failure vocabulary, the loader that refuses the
 * network, and the policy that decides what a saved Vega-Lite specification
 * may contain.
 *
 * It sits in the contract package because both sides load it. The workbench
 * renders from it in a browser, and the server admits a saved chart with it —
 * `AnalyticsSavedWorkbenchChartPolicy` in `@langwatch/dashboard-server` is
 * reached from ten API compositions. While these modules lived in
 * `@langwatch/analytics-web` that made a backend process the downstream of a
 * package built and reviewed as browser code, which is what
 * `frontend-boundary.unit.test.ts` refuses: a module in a browser package that
 * looks framework-free today acquires a React edge the next time somebody
 * edits it, and nothing in that review would say an API process is downstream.
 *
 * The schema validator is deliberately NOT here. `./validation` is its entry
 * point, because loading 8MB of ahead-of-time compiled Ajv is right while a
 * chart is being saved and wrong for an ordinary browser import of the theme
 * and policy helpers.
 */
export * from "./build-langwatch-ql-vega-spec.ts";
export * from "./langwatch-vega-config.ts";
export * from "./lwql-chart-failures.ts";
export * from "./lwql-dataset-names.ts";
export * from "./no-network-vega-loader.ts";
export * from "./scan-langwatch-ql-chart-values.ts";
export * from "./starter-vega-lite-spec.ts";
export * from "./vega-lite-expressions.ts";
export * from "./vega-lite-fields.ts";
export * from "./vega-lite-policy.ts";
export * from "./vega-lite-structure.ts";
export * from "./vega-lite-transforms.ts";
export * from "./visualization-types.ts";
