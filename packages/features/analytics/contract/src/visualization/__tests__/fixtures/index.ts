/**
 * The Vega-Lite specification corpus, published for the browser package whose
 * chart surfaces are exercised against the same specifications the policy is.
 *
 * One corpus, two readers. A second copy would let the workbench render a spec
 * this package refuses, which is precisely the disagreement the fixtures
 * exist to make impossible.
 */
export * from "./adversarial/index.ts";
export * from "./invalid/index.ts";
export * from "./lwql-dataset-registry.ts";
export * from "./valid/index.ts";
