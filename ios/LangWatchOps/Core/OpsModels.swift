import Foundation

/// Wire types for `/api/ops/mobile/*`.
///
/// These mirror the server DTOs in `langwatch/src/server/app-layer/ops/types.ts`
/// and `mobile-ops.service.ts`. Every field the server can send as `null` is an
/// optional here — a decoding failure would blank a whole screen, and an ops
/// screen that refuses to render is worse than one missing a number.
///
/// Numeric fields are `Double` where the server can send a fraction (rates,
/// percentages) and `Int` only where it is counting things.

// MARK: - Scope

struct ScopeResponse: Decodable, Sendable {
    let userId: String
    let email: String?
    let hasOpsAccess: Bool
    let opsModuleAvailable: Bool
}

// MARK: - Dashboard

struct DashboardResponse: Decodable, Sendable {
    let hasSnapshot: Bool
    let snapshot: DashboardSnapshot
}

struct DashboardSnapshot: Decodable, Sendable {
    let totalGroups: Int
    let blockedGroups: Int
    let parkedGroups: Int
    let totalPendingJobs: Int
    /// Counter minus ground truth from the last reconcile. Zero is healthy.
    let pendingDrift: Int

    let throughputIngestedPerSec: Double
    let totalCompleted: Int
    let totalFailed: Int
    let completedPerSec: Double
    let failedPerSec: Double
    let peakCompletedPerSec: Double
    let peakFailedPerSec: Double
    let peakIngestedPerSec: Double

    let redisMemoryUsedBytes: Int
    let redisMemoryPeakBytes: Int
    let redisMemoryMaxBytes: Int
    let redisConnectedClients: Int
    /// Null on the first cycle and just after a Redis restart.
    let redisEngineCpuPercent: Double?

    let processCpuPercent: Double
    let processMemoryUsedMb: Int
    let processMemoryTotalMb: Int

    let latencyP50Ms: Double
    let latencyP99Ms: Double
    let peakLatencyP50Ms: Double
    let peakLatencyP99Ms: Double

    let throughputHistory: [ThroughputPoint]
    let queues: [QueueSummary]
    let phases: Phases
    let pausedKeys: [String]
    let topErrors: [ErrorCluster]

    struct Phases: Decodable, Sendable {
        let commands: PhaseMetrics
        let projections: PhaseMetrics
        let reactions: PhaseMetrics
    }
}

struct PhaseMetrics: Decodable, Sendable {
    let pending: Int
    let active: Int
    let completedPerSec: Double
    let failedPerSec: Double
    let latencyP50Ms: Double
    let latencyP99Ms: Double
}

struct ThroughputPoint: Decodable, Sendable, Identifiable {
    /// Unix milliseconds.
    let timestamp: Double
    let ingestedPerSec: Double
    let completedPerSec: Double
    let failedPerSec: Double
    let pendingCount: Int
    let blockedCount: Int
    let parkedCount: Int

    var id: Double { timestamp }
    var date: Date { Date(timeIntervalSince1970: timestamp / 1000) }
}

struct ErrorCluster: Decodable, Sendable, Identifiable {
    let normalizedMessage: String
    let sampleMessage: String
    let sampleStack: String?
    let count: Int
    let pipelineName: String?
    let queueName: String
    let sampleGroupIds: [String]

    var id: String { "\(queueName)/\(normalizedMessage)" }
}

struct BadgeCounts: Decodable, Sendable {
    let blockedCount: Int
    let dlqCount: Int
    let computedAt: String

    var total: Int { blockedCount + dlqCount }
}

// MARK: - Queues

struct QueuesResponse: Decodable, Sendable {
    let queues: [QueueSummary]
}

struct QueueSummary: Decodable, Sendable, Identifiable {
    let name: String
    let displayName: String
    let pendingGroupCount: Int
    let blockedGroupCount: Int
    let activeGroupCount: Int
    let totalPendingJobs: Int
    let dlqCount: Int
    /// Groups a tenant soft-cap parked out of the ready scan.
    let parkedGroupCount: Int

    var id: String { name }

    /// Anything an operator would want to look at first.
    var needsAttention: Bool { blockedGroupCount > 0 || dlqCount > 0 }
}

struct GroupsPage: Decodable, Sendable {
    let groups: [QueueGroup]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct QueueGroup: Decodable, Sendable, Identifiable {
    let groupId: String
    let pendingJobs: Int
    let hasActiveJob: Bool
    let activeJobId: String?
    let isBlocked: Bool
    let oldestJobMs: Double?
    let newestJobMs: Double?
    /// A block old enough that nothing is retrying it any more.
    let isStaleBlock: Bool
    let pipelineName: String?
    let jobType: String?
    let jobName: String?
    let errorMessage: String?
    let errorStack: String?
    let errorTimestamp: Double?
    let retryCount: Int?
    let activeKeyTtlSec: Double?
    let processingDurationMs: Double?

    var id: String { groupId }
}

struct JobsPage: Decodable, Sendable {
    let jobs: [JobSummary]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// Deliberately payload-free — see `MobileOpsService.getGroupJobs` on the server
/// for why a phone gets the shape and the size but never the contents.
struct JobSummary: Decodable, Sendable, Identifiable {
    let jobId: String
    let score: Double
    let payloadKeys: [String]
    let payloadBytes: Int

    var id: String { jobId }
}

struct BlockedSummary: Decodable, Sendable {
    let totalBlocked: Int
    let clusters: [ErrorCluster]
}

struct PausedKeysResponse: Decodable, Sendable {
    let keys: [String]
}

struct PausedTenantsResponse: Decodable, Sendable {
    let tenants: [String]
}

// MARK: - Dead letters

struct DlqResponse: Decodable, Sendable {
    let groups: [DlqGroup]
}

struct DlqGroup: Decodable, Sendable, Identifiable {
    let queueName: String
    let queueDisplayName: String
    let groupId: String
    let error: String?
    let errorStack: String?
    let pipelineName: String?
    let jobCount: Int
    /// Unix milliseconds.
    let movedAt: Double?

    var id: String { "\(queueName)/\(groupId)" }
    var movedAtDate: Date? { movedAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
}

// MARK: - Anomalies

struct AnomaliesResponse: Decodable, Sendable {
    let anomalies: [Anomaly]
}

struct Anomaly: Decodable, Sendable, Identifiable {
    let tenantId: String
    let kind: String
    /// "hard" or "surface".
    let tier: String
    let currentRate: Double
    let baseline: Double
    /// Unix milliseconds.
    let triggeredAt: Double
    let contributors: [String: Double]?
    let reason: String

    var id: String { "\(kind):\(tenantId)" }
    var isHardTier: Bool { tier == "hard" }
    var triggeredAtDate: Date { Date(timeIntervalSince1970: triggeredAt / 1000) }

    /// How many times over baseline. Nil when there is no baseline to divide by,
    /// which is a real state on a tenant that had no traffic at all before.
    var multipleOfBaseline: Double? {
        baseline > 0 ? currentRate / baseline : nil
    }
}

// MARK: - Scheduler

struct SchedulerResponse: Decodable, Sendable {
    let jobs: [ScheduledJob]
}

struct ScheduledJob: Decodable, Sendable, Identifiable {
    let id: String
    let projectId: String
    let targetType: String
    let targetId: String
    let cron: String
    let timezone: String
    /// ISO-8601.
    let nextRunAt: String
    let lastSlot: String?
    let active: Bool
    let createdAt: String
    /// The slot being worked, or nil when idle.
    let currentSlot: String?
    let attempts: Int
    let lastError: String?
    let updatedAt: String

    /// A schedule that has failed and is retrying, which is what an operator is
    /// scanning this list for.
    var isStruggling: Bool { attempts > 0 && lastError != nil }
}

// MARK: - The Foundry

struct FoundryPresetsResponse: Decodable, Sendable {
    let presets: [FoundryPreset]
}

struct FoundryPreset: Decodable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
    let serviceName: String?
    let spanCount: Int
    let spans: [FoundrySpan]
}

/// A span in a preset's generated trace.
///
/// No `Identifiable` conformance on purpose: spans carry no server-side id and
/// two siblings can legitimately share a name, so any identity derived from the
/// contents would collide. `FlatSpan` (see the Foundry screen) assigns identity
/// from the position in the tree when it flattens one for display.
struct FoundrySpan: Decodable, Sendable {
    let name: String
    let type: String
    let durationMs: Double
    let status: String
    let model: String?
    let children: [FoundrySpan]
}

// MARK: - Payload store

enum BlobSort: String, CaseIterable, Identifiable, Sendable {
    case largest
    case stalest
    case unreferenced
    case oldestLapsedLease = "oldest_lapsed_lease"
    case scan

    var id: String { rawValue }

    var label: String {
        switch self {
        case .largest: return "Largest"
        case .stalest: return "Stalest"
        case .unreferenced: return "Unreferenced"
        case .oldestLapsedLease: return "Lapsed lease"
        case .scan: return "Everything"
        }
    }

    var explanation: String {
        switch self {
        case .largest:
            return "Biggest payloads first — what is actually occupying the instance."
        case .stalest:
            return "Least recently touched first. Every access re-arms the expiry, so a low remaining time means nothing has read this in a while."
        case .unreferenced:
            return "Nothing holds a live lease. This is the reclaimable set."
        case .oldestLapsedLease:
            return "Longest-lapsed lease first — where a holder most likely died mid-flight."
        case .scan:
            return "Storage order. The only complete walk; no ranking."
        }
    }
}

struct BlobStoreStats: Decodable, Sendable {
    let queues: [QueueStats]

    struct QueueStats: Decodable, Sendable, Identifiable {
        let queueName: String
        /// Sampled, not exact — a full count of a multi-million-key keyspace is
        /// not a request-time operation.
        let sampledBlobs: Int
        let sampledBytes: Int
        let unreferenced: Int
        let truncated: Bool

        var id: String { queueName }
    }
}

struct BlobPage: Decodable, Sendable {
    let blobs: [BlobSummary]
    /// Opaque; pass back to continue. Nil when the walk is finished.
    let nextCursor: String?
    /// Blobs examined to produce this page.
    let sampled: Int
    /// True when the order is a best-of-sample rather than a true top-N.
    let rankedFromSample: Bool
}

struct BlobSummary: Decodable, Sendable, Identifiable {
    let queueName: String
    let projectId: String
    let hash: String
    let sizeBytes: Int
    /// Seconds until expiry; nil when the key carries no expiry at all.
    let ttlSeconds: Double?
    let liveLeases: Int
    let holderTokens: Int
    /// Earliest lease deadline in Redis-time ms; nil when no lease remains.
    /// In the past, it dates the oldest LAPSED lease — the sharpest available
    /// signal for "a worker died here".
    let earliestLeaseDeadlineMs: Double?
    /// What a sweep would decide for this blob right now.
    let sweepOutcome: String

    var id: String { "\(queueName)/\(projectId)/\(hash)" }
    var isReclaimable: Bool { liveLeases == 0 }
}

struct BlobSweepReport: Decodable, Sendable {
    let queues: [QueueTally]
    let totals: SweepTally
    let dryRun: Bool
    let durationMs: Double

    struct QueueTally: Decodable, Sendable, Identifiable {
        let queueName: String
        let scanned: Int
        let truncated: Bool
        let leased: Int
        let repaired: Int
        let reclaimed: Int
        let bookkeeping: Int
        let pending: Int

        var id: String { queueName }
    }

    struct SweepTally: Decodable, Sendable {
        let scanned: Int
        let truncated: Bool
        let leased: Int
        let repaired: Int
        let reclaimed: Int
        let bookkeeping: Int
        let pending: Int
    }
}

// MARK: - Projections

struct ProjectionCatalog: Decodable, Sendable {
    let projections: [Projection]
    let eventSubscribers: [EventSubscriber]
}

struct Projection: Decodable, Sendable, Identifiable {
    let projectionName: String
    let pipelineName: String
    let aggregateType: String
    let pauseKey: String
    /// "fold" or "map".
    let kind: String

    var id: String { pauseKey }
}

struct EventSubscriber: Decodable, Sendable, Identifiable {
    let subscriberName: String
    let pipelineName: String
    let aggregateType: String
    let eventTypes: [String]

    var id: String { "\(pipelineName)/\(subscriberName)" }
}

struct ReplayStatus: Decodable, Sendable {
    /// idle | running | completed | failed | cancelled
    let state: String
    let runId: String?
    let startedAt: String?
    let completedAt: String?
    let projectionNames: [String]
    let since: String
    let tenantIds: [String]
    let currentProjection: String?
    let currentPhase: String?
    let aggregatesProcessed: Int
    let aggregatesTotal: Int
    let eventsProcessed: Int
    let error: String?
    let description: String?
    let userName: String?

    var isRunning: Bool { state == "running" }

    /// Nil rather than zero while the total is still unknown, so the UI can show
    /// an indeterminate bar instead of a bar that looks stuck at 0%.
    var progress: Double? {
        guard aggregatesTotal > 0 else { return nil }
        return min(1, Double(aggregatesProcessed) / Double(aggregatesTotal))
    }
}

struct ReplayHistoryResponse: Decodable, Sendable {
    let history: [ReplayRun]
}

struct ReplayRun: Decodable, Sendable, Identifiable {
    let runId: String
    let projectionNames: [String]
    let since: String
    let tenantIds: [String]
    let description: String
    let startedAt: String
    let completedAt: String?
    /// completed | failed | cancelled
    let state: String
    let userName: String
    let aggregatesProcessed: Int
    let eventsProcessed: Int
    let error: String?

    var id: String { runId }
}
