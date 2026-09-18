/**
 * Moved to `@langwatch/browser-host/transport` — framework, not feature; the
 * record (§10.1, amended 2026-09-18) says `apps/ui` holds only `main.tsx` and
 * `styles/`. This re-export stays until every importer here repoints.
 */

export {
  createUiFeatureApiClient,
  UI_SSE_ENDPOINT_PREFIX,
  UI_TRPC_ENDPOINT,
  type UiFeatureApiBinding,
  type UiFeatureApiClientOptions,
  type UiFeatureApiProvider,
  type UiFeatureApiTransport,
} from "@langwatch/browser-host/transport";
