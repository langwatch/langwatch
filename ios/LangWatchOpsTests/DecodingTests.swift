import XCTest

@testable import LangWatchOps

/// Decoding against payloads shaped like the ones `/api/ops/mobile/*` actually
/// returns, including the nulls. A field the server can send as `null` that is
/// decoded as non-optional blanks the whole screen, and that failure only shows
/// up on the one instance that happens to have a null there.
final class DecodingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, from json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    func testAGroupWithNoErrorDecodes() throws {
        let group = try decode(
            QueueGroup.self,
            from: """
            {
              "groupId": "project-1/trace-9",
              "pendingJobs": 3,
              "score": 12,
              "hasActiveJob": false,
              "activeJobId": null,
              "isBlocked": false,
              "oldestJobMs": 1767000000000,
              "newestJobMs": null,
              "isStaleBlock": false,
              "pipelineName": "traces",
              "jobType": null,
              "jobName": null,
              "errorMessage": null,
              "errorStack": null,
              "errorTimestamp": null,
              "retryCount": null,
              "activeKeyTtlSec": null,
              "processingDurationMs": null
            }
            """
        )

        XCTAssertEqual(group.groupId, "project-1/trace-9")
        XCTAssertNil(group.errorMessage)
        XCTAssertFalse(group.isBlocked)
    }

    func testABlobWithNoExpiryDecodes() throws {
        // `ttlSeconds: null` means the key carries no expiry at all — a real
        // state, and a different one from "expires soon".
        let blob = try decode(
            BlobSummary.self,
            from: """
            {
              "queueName": "langwatch:traces:gq",
              "projectId": "project-1",
              "hash": "abc123",
              "sizeBytes": 4096,
              "ttlSeconds": null,
              "liveLeases": 0,
              "holderTokens": 0,
              "earliestLeaseDeadlineMs": null,
              "sweepOutcome": "reclaimed"
            }
            """
        )

        XCTAssertNil(blob.ttlSeconds)
        XCTAssertTrue(blob.isReclaimable)
        XCTAssertEqual(blob.sweepOutcome, "reclaimed")
    }

    func testABlobWithALiveLeaseIsNotReclaimable() throws {
        let blob = try decode(
            BlobSummary.self,
            from: """
            {
              "queueName": "q",
              "projectId": "p",
              "hash": "h",
              "sizeBytes": 10,
              "ttlSeconds": 900,
              "liveLeases": 2,
              "holderTokens": 3,
              "earliestLeaseDeadlineMs": 1767000000000,
              "sweepOutcome": "leased"
            }
            """
        )

        XCTAssertFalse(blob.isReclaimable)
    }

    func testASweepReportDecodesItsTallies() throws {
        let report = try decode(
            BlobSweepReport.self,
            from: """
            {
              "queues": [
                {
                  "queueName": "langwatch:traces:gq",
                  "scanned": 120,
                  "truncated": false,
                  "leased": 100,
                  "repaired": 8,
                  "reclaimed": 10,
                  "bookkeeping": 1,
                  "pending": 1
                }
              ],
              "totals": {
                "scanned": 120,
                "truncated": false,
                "leased": 100,
                "repaired": 8,
                "reclaimed": 10,
                "bookkeeping": 1,
                "pending": 1
              },
              "dryRun": true,
              "durationMs": 42.5
            }
            """
        )

        XCTAssertTrue(report.dryRun)
        XCTAssertEqual(report.totals.reclaimed, 10)
        XCTAssertEqual(report.queues.first?.queueName, "langwatch:traces:gq")
    }

    func testAnAnomalyWithoutContributorsDecodes() throws {
        let anomaly = try decode(
            Anomaly.self,
            from: """
            {
              "tenantId": "project-1",
              "kind": "rate_breaker",
              "tier": "hard",
              "currentRate": 120,
              "baseline": 10,
              "triggeredAt": 1767000000000,
              "reason": "rate 12x above baseline"
            }
            """
        )

        XCTAssertTrue(anomaly.isHardTier)
        XCTAssertNil(anomaly.contributors)
        XCTAssertEqual(anomaly.multipleOfBaseline, 12)
    }

    func testAnAnomalyOnATenantWithNoBaselineHasNoMultiple() throws {
        // A tenant that had no traffic at all cannot have a multiple, and
        // dividing by zero would put "inf" on the screen.
        let anomaly = try decode(
            Anomaly.self,
            from: """
            {
              "tenantId": "project-2",
              "kind": "rate_breaker",
              "tier": "surface",
              "currentRate": 50,
              "baseline": 0,
              "triggeredAt": 1767000000000,
              "reason": "first traffic"
            }
            """
        )

        XCTAssertNil(anomaly.multipleOfBaseline)
    }

    func testAnIdleReplayHasNoProgress() throws {
        let status = try decode(
            ReplayStatus.self,
            from: """
            {
              "state": "idle",
              "runId": null,
              "startedAt": null,
              "completedAt": null,
              "projectionNames": [],
              "since": "",
              "tenantIds": [],
              "currentProjection": null,
              "currentPhase": null,
              "aggregatesProcessed": 0,
              "aggregatesTotal": 0,
              "eventsProcessed": 0,
              "error": null,
              "description": null,
              "userName": null
            }
            """
        )

        XCTAssertFalse(status.isRunning)
        // Nil, not zero: a bar stuck at 0% reads as a replay that is not moving.
        XCTAssertNil(status.progress)
    }

    func testARunningReplayReportsProgress() throws {
        let status = try decode(
            ReplayStatus.self,
            from: """
            {
              "state": "running",
              "runId": "run-1",
              "startedAt": "2026-01-02T03:04:05.000Z",
              "completedAt": null,
              "projectionNames": ["trace_summary"],
              "since": "2026-01-01",
              "tenantIds": [],
              "currentProjection": "trace_summary",
              "currentPhase": "aggregates",
              "aggregatesProcessed": 25,
              "aggregatesTotal": 100,
              "eventsProcessed": 900,
              "error": null,
              "description": "backfill",
              "userName": "operator"
            }
            """
        )

        XCTAssertTrue(status.isRunning)
        XCTAssertEqual(status.progress, 0.25)
    }

    func testAJobSummaryCarriesShapeButNoPayload() throws {
        let page = try decode(
            JobsPage.self,
            from: """
            {
              "jobs": [
                { "jobId": "job-1", "score": 5, "payloadKeys": ["prompt", "traceId"], "payloadBytes": 46 }
              ],
              "total": 1,
              "page": 1,
              "pageSize": 20
            }
            """
        )

        XCTAssertEqual(page.jobs.first?.payloadKeys, ["prompt", "traceId"])
        XCTAssertEqual(page.jobs.first?.payloadBytes, 46)
    }

    func testAQueueWithBlockedGroupsNeedsAttention() throws {
        let queue = try decode(
            QueueSummary.self,
            from: """
            {
              "name": "langwatch:traces:gq",
              "displayName": "traces",
              "pendingGroupCount": 4,
              "blockedGroupCount": 2,
              "activeGroupCount": 1,
              "totalPendingJobs": 40,
              "dlqCount": 0,
              "parkedGroupCount": 0
            }
            """
        )

        XCTAssertTrue(queue.needsAttention)
    }

    func testAHealthyQueueDoesNotNeedAttention() throws {
        let queue = try decode(
            QueueSummary.self,
            from: """
            {
              "name": "langwatch:traces:gq",
              "displayName": "traces",
              "pendingGroupCount": 400,
              "blockedGroupCount": 0,
              "activeGroupCount": 8,
              "totalPendingJobs": 4000,
              "dlqCount": 0,
              "parkedGroupCount": 0
            }
            """
        )

        // A big backlog drains on its own. A block does not — that is the
        // difference this flag exists to draw.
        XCTAssertFalse(queue.needsAttention)
    }

    func testTheDashboardToleratesAMissingRedisCpuSample() throws {
        let response = try decode(
            DashboardResponse.self,
            from: dashboardJSON(redisEngineCpuPercent: "null")
        )

        XCTAssertFalse(response.hasSnapshot)
        XCTAssertNil(response.snapshot.redisEngineCpuPercent)
    }

    func testTheDashboardDecodesAFullSnapshot() throws {
        let response = try decode(
            DashboardResponse.self,
            from: dashboardJSON(redisEngineCpuPercent: "12.5")
        )

        XCTAssertEqual(response.snapshot.redisEngineCpuPercent, 12.5)
        XCTAssertEqual(response.snapshot.phases.commands.pending, 1)
        XCTAssertEqual(response.snapshot.topErrors.first?.count, 7)
    }

    private func dashboardJSON(redisEngineCpuPercent: String) -> String {
        """
        {
          "hasSnapshot": false,
          "snapshot": {
            "totalGroups": 10,
            "blockedGroups": 2,
            "parkedGroups": 0,
            "totalPendingJobs": 55,
            "pendingDrift": 0,
            "throughputIngestedPerSec": 4.5,
            "totalCompleted": 900,
            "totalFailed": 3,
            "completedPerSec": 4.1,
            "failedPerSec": 0,
            "peakCompletedPerSec": 20,
            "peakFailedPerSec": 1,
            "peakIngestedPerSec": 22,
            "redisMemoryUsedBytes": 1048576,
            "redisMemoryPeakBytes": 2097152,
            "redisMemoryMaxBytes": 0,
            "redisConnectedClients": 12,
            "redisEngineCpuPercent": \(redisEngineCpuPercent),
            "processCpuPercent": 3.2,
            "processMemoryUsedMb": 512,
            "processMemoryTotalMb": 8192,
            "latencyP50Ms": 12,
            "latencyP99Ms": 240,
            "peakLatencyP50Ms": 30,
            "peakLatencyP99Ms": 900,
            "throughputHistory": [],
            "queues": [],
            "phases": {
              "commands": { "pending": 1, "active": 0, "completedPerSec": 1, "failedPerSec": 0, "latencyP50Ms": 5, "latencyP99Ms": 20 },
              "projections": { "pending": 0, "active": 1, "completedPerSec": 2, "failedPerSec": 0, "latencyP50Ms": 6, "latencyP99Ms": 25 },
              "reactions": { "pending": 0, "active": 0, "completedPerSec": 0, "failedPerSec": 0, "latencyP50Ms": 0, "latencyP99Ms": 0 }
            },
            "pausedKeys": [],
            "topErrors": [
              {
                "normalizedMessage": "ECONNRESET",
                "sampleMessage": "read ECONNRESET",
                "sampleStack": null,
                "count": 7,
                "pipelineName": "traces",
                "queueName": "langwatch:traces:gq",
                "sampleGroupIds": ["project-1/trace-1"]
              }
            ]
          }
        }
        """
    }
}
