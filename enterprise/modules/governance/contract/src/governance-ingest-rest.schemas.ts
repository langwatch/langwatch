// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the `/api/ingest` receivers read off the path. An exporter is
 * configured with `{base}/api/ingest/otel/{sourceId}` and appends OTLP's own
 * suffix, so the source id is the whole of the declared input.
 */
import { z } from "zod";

export const governanceIngestSourceParamsSchema = z.object({ sourceId: z.string().min(1) });
