import type { ClickHouseClient } from "@clickhouse/client";
import { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { createS3Client } from "~/server/storage";
import type { BlobResolutionDeps } from "./trace.service";

/**
 * Default ClickHouse client resolver: given a tenantId (projectId), returns the
 * right ClickHouse client. Identical to the closure `presets.ts` builds at the
 * composition root — kept here so both the request layer and the app layer
 * construct {@link BlobResolutionDeps} from one definition.
 */
const defaultResolveClickHouseClient: ClickHouseClientResolver = async (
  tenantId: string,
): Promise<ClickHouseClient> => {
  const client = await getClickHouseClientForProject(tenantId);
  if (!client) {
    throw new Error("ClickHouse not available for this tenant");
  }
  return client;
};

/**
 * Builds the ADR-022 blob-resolution dependencies ({@link BlobResolutionDeps})
 * used by the opt-in `full=true` trace-detail read path (#4888).
 *
 * The tRPC/REST request layer has no DI container — `ctx` carries only
 * `prisma`, and the resolving `TraceService` minted in `presets.ts` lives
 * inside `initializeWebApp` (worker-only import). So the customer detail
 * procedures can't reach the app-layer deps. This factory is the single
 * source of truth for constructing those deps; `presets.ts` consumes it too
 * (passing its own composition-root values) so the `new BlobStore(...)` +
 * `new TraceIOExtractionService()` shape is defined in exactly one place.
 *
 * Construction does NO network I/O: `BlobStore` only stores the resolver
 * callbacks (S3 client factory + ClickHouse client resolver); the actual
 * `event_log` SELECT happens lazily inside `getFromEventLog`, and only when a
 * read passes `full: true` AND the trace carries eventref pointers. Building
 * these deps on every detail request is therefore free.
 *
 * When ClickHouse is not configured in this process, the ClickHouse resolver
 * is omitted (mirroring `presets.ts`); `getFromEventLog` then throws, which
 * `resolveOffloadedTraces` swallows per-field — the read degrades gracefully
 * to the preview rather than 500ing.
 *
 * @param overrides - Optional composition-root values. `presets.ts` passes its
 *   own `clickhouseEnabled` (which also honors `config.clickhouseUrl`) and
 *   `resolveClickHouseClient` so the eval-path deps stay byte-identical to the
 *   pre-#4888 wiring. Routers call with no arguments.
 */
export function buildTraceBlobResolutionDeps(overrides?: {
  clickhouseEnabled?: boolean;
  resolveClickHouseClient?: ClickHouseClientResolver;
}): BlobResolutionDeps {
  const clickhouseEnabled =
    overrides?.clickhouseEnabled ?? isClickHouseEnabled();
  const resolveClickHouseClient =
    overrides?.resolveClickHouseClient ?? defaultResolveClickHouseClient;

  return {
    blobStore: new BlobStore(
      createS3Client,
      clickhouseEnabled ? resolveClickHouseClient : undefined,
    ),
    ioExtractionService: new TraceIOExtractionService(),
  };
}
