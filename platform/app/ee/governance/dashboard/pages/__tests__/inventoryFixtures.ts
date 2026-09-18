// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The source rows the Inventory suites are written against.
 *
 * Split from the harness so the harness stays under the size limit, and
 * because these are data rather than setup: a suite that needs a different
 * fleet adds a fixture here without touching the mocks.
 */

/**
 * A Genie source and a Copilot Studio one: between them they cover a card with
 * a licence read, a card without, and two different environment addresses.
 */
export const CONNECTED_SOURCES = [
  {
    id: "src-genie",
    organizationId: "org-1",
    teamId: null,
    name: "Warehouse questions",
    description: null,
    sourceType: "databricks_genie",
    parserConfig: { workspaceUrl: "https://example-workspace.cloud.test/" },
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    traceProjectId: null,
    traceProjectArchived: false,
    archivedAt: null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    updatedAt: new Date("2026-04-02T10:00:00.000Z"),
    createdById: null,
    hasPollerCursor: false,
    pullSchedule: null,
  },
  {
    id: "src-copilot",
    organizationId: "org-1",
    teamId: null,
    name: "Assistant transcripts",
    description: null,
    sourceType: "copilot_studio_dataverse",
    parserConfig: {
      environmentUrl: "https://example-env.crm.test",
      readSeats: true,
    },
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    traceProjectId: null,
    traceProjectArchived: false,
    archivedAt: null,
    createdAt: new Date("2026-05-11T08:30:00.000Z"),
    updatedAt: new Date("2026-05-11T08:30:00.000Z"),
    createdById: null,
    hasPollerCursor: false,
    pullSchedule: null,
  },
];
