// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The source rows the Inventory suites are written against.
 *
 * Split from the harness so the harness stays under the size limit, and
 * because these are data rather than setup: a suite that needs a different
 * fleet adds a fixture here without touching the mocks.
 */

/**
 * A Genie source and a Copilot Studio one: between them they cover a source
 * with a licence read, one without, and two different environment addresses.
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

/**
 * Three registered tools, one per registry type, so the suites cover the three
 * different row shapes: a subscription-billed coding assistant, a
 * consumption-billed model provider, and an in-house tool.
 *
 * Deliberately nothing to do with {@link CONNECTED_SOURCES}. The catalog lists
 * the registry, not the fleet, and a fixture where the two lined up would let
 * a test pass against the linkage that was removed.
 */
export const REGISTERED_TOOLS = [
  {
    id: "tool-claude-code",
    organizationId: "org-1",
    scope: "organization",
    scopeId: "org-1",
    departmentIds: [],
    type: "coding_assistant",
    displayName: "Claude Code",
    slug: "claude-code",
    iconKey: null,
    iconAsset: "preset:claude_code",
    order: 0,
    enabled: true,
    config: { assistantKind: "claude_code", setupCommand: "langwatch claude" },
    archivedAt: null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    updatedAt: new Date("2026-04-02T10:00:00.000Z"),
    createdById: null,
    updatedById: null,
  },
  {
    id: "tool-openai",
    organizationId: "org-1",
    scope: "organization",
    scopeId: "org-1",
    departmentIds: [],
    type: "model_provider",
    displayName: "OpenAI",
    slug: "openai",
    iconKey: null,
    iconAsset: "preset:openai",
    order: 1,
    enabled: true,
    config: { providerKey: "openai", defaultLabel: "openai-key" },
    archivedAt: null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    updatedAt: new Date("2026-04-02T10:00:00.000Z"),
    createdById: null,
    updatedById: null,
  },
  {
    id: "tool-support-desk",
    organizationId: "org-1",
    scope: "organization",
    scopeId: "org-1",
    departmentIds: [],
    type: "external_tool",
    displayName: "Support Desk Assistant",
    slug: "support-desk-assistant",
    iconKey: null,
    iconAsset: null,
    order: 2,
    // Registered but not published, so a suite can assert the inventory still
    // lists a tool nobody in the organization can launch.
    enabled: false,
    config: {
      descriptionMarkdown: "The in-house assistant behind the support desk.",
      linkUrl: "https://example.test/support-desk",
    },
    archivedAt: null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    updatedAt: new Date("2026-04-02T10:00:00.000Z"),
    createdById: null,
    updatedById: null,
  },
];
