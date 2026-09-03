/**
 * The one Prisma client this process opens, as a composition-time double.
 *
 * WHY EVERY MODEL IS NAMED. Since the trace conversion, `WorkerProductionComposition`
 * builds the four capability services, the feature-flag store, the dataset
 * content repository, the trace-trigger catalogue and the BYOC storage lookup
 * during `create()` — and several of those repositories check at CONSTRUCTION
 * that the object they were handed is a Prisma client for the models they read,
 * rather than failing on the first query. That check is deliberate: a graph
 * composed against the wrong client should refuse at boot, not at 3am on the
 * first span.
 *
 * So the list below is not padding. It is the answer to "which tables does one
 * worker process touch", and a composition test that could pass with fewer
 * would be a test that stopped noticing when a feature reached for a new one.
 * Nothing here executes: every entry is an empty delegate, because these tests
 * assert what was COMPOSED, never what it reads.
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
    ...overrides,
  };
}
