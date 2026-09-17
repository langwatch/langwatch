/**
 * Validates which Prisma models the composition accesses at construction.
 * Each entry is an empty delegate; tests assert what was composed, not what it reads.
 */
export function createWorkerProcessDatabase(overrides: object = {}) {
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async <Result>(callback: (transaction: object) => Promise<Result>) =>
      callback({}),
    // Eventing's own process-manager persistence.
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
    // The coding-agent fold stamps this behind each commit; trace's project
    // metadata subscriber writes it; BYOC storage routing reads it.
    project: { updateMany: async () => ({ count: 0 }), findUnique: async () => null },
    team: {},
    // Record-time cost enrichment, privacy resolution and monitor listing.
    customLLMModelCost: {},
    dataPrivacyPolicy: {},
    monitor: {},
    // The kill switches every record-time port is behind.
    featureFlag: {},
    featureFlagExperiment: {},
    // Dataset normalization's chunk write.
    dataset: {},
    datasetRecord: {},
    // The project's trace automations.
    trigger: {},
    // The model gateway: the provider rows, the change log its writes append
    // to, the per-scope defaults and the custom cost catalogue. The three
    // repositories behind them check at CONSTRUCTION that the client names
    // their models, so a graph composing the gateway needs every one.
    modelProvider: {},
    gatewayChangeEvent: {},
    modelDefaultConfig: {},
    modelDefaultConfigScope: {},
    // The tenancy graph: the organization, its teams and groups, the grants
    // read model with its audit trail, and the per-organization engine
    // migration state the cutover gate reads.
    organization: {},
    group: {},
    roleBinding: {},
    auditLog: {},
    organizationAuthzMigration: {},
    // Langy's conversation graph: two operational folds, the per-message
    // projection, the turn admission ledger and the session-key reap.
    apiKey: {},
    virtualKey: {},
    langyConversationProjection: {},
    langyConversationTurnProjection: {},
    langyMessageProjection: {},
    langyTurnRequest: {},
    langyActiveTurn: {},
    // The directory-sync ledger: SCIM's repository checks at construction that
    // the client names every model its reads and writes touch.
    organizationUser: {},
    groupMembership: {},
    scimToken: {},
    ssoConnection: {},
    scimExternalId: {},
    ...overrides,
  };
}
