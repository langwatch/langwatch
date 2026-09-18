/**
 * The seam between a feature package and the shell it mounts in — re-exports
 * the real definitions rather than restating them (ARCHITECTURE.md §10.1).
 */

export type { UiPageLoader, UiPageLoaderRegistry } from "./ui-page-loaders.ts";
export { resolveUiPageLoader, uiRoutePageKeys } from "./ui-page-loaders.ts";
export type { UiPageLoaderMerge } from "./ui-feature-loaders.ts";
export { mergeUiPageLoaders } from "./ui-feature-loaders.ts";
export type { UiFailureHost, UiFailureInterceptor, UiFeatureInstall } from "./ui-feature.ts";
