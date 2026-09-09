// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Source } from "../pages/ingestionSourceForms";
import { SAMPLE_TOOL_CARDS } from "./toolCatalog/sampleToolCards";

/** Use the catalog's supported tools for the read-only Sources preview. */
export const SAMPLE_INGESTION_SOURCES: Source[] = SAMPLE_TOOL_CARDS.flatMap(
  (tool) =>
    tool.sourceType === null
      ? []
      : [
          {
            id: tool.id,
            organizationId: "sample",
            teamId: null,
            name: tool.name,
            description: null,
            sourceType: tool.sourceType,
            parserConfig: {},
            status: "active",
            errorCount: 0,
            lastSuccessAt: null,
            lastEventAt: null,
            traceProjectId: null,
            traceProjectArchived: false,
            archivedAt: null,
            createdAt: new Date("2026-06-01T00:00:00Z"),
            updatedAt: new Date("2026-06-01T00:00:00Z"),
            createdById: null,
            hasPollerCursor: false,
            pullSchedule: null,
          },
        ],
);
