/**
 * Client-safe constants for ingestion sources.
 *
 * Kept separate from `ingestionSource.service.ts` so the dashboard page can
 * import the cap without pulling the service's server-only dependencies
 * (Prisma, app layer, `node:async_hooks` AsyncLocalStorage) into the client
 * bundle — that leak crashes the page at load with "AsyncLocalStorage is not a
 * constructor".
 */

/**
 * Non-enterprise plans can create up to this many active IngestionSources
 * per org. Composer separately restricts source TYPE to otel_generic, so
 * a non-enterprise org gets 3 generic OTel sources to try the pillar
 * before needing to upgrade. Spec: specs/ai-gateway/license-gate-governance.feature.
 */
export const NON_ENTERPRISE_INGESTION_SOURCE_CAP = 3;
