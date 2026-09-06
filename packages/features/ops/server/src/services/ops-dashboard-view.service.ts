/**
 * The dashboard payload a viewer reads: the queue rollups, the pipeline tree the sidebar walks, and
 * the error clusters worth showing first. Built from a window and the writer's latest detail scan,
 * so the same figures serve this pod's own view and the artifact it publishes.
 */

import * as os from "node:os";
import type {
  DashboardData,
  RedisInfo,
  DetailSnapshot,
  PipelineNode,
  QueueInfo,
  QueueSummaryInfo,
} from "@langwatch/ops-contract";
import { normalizeErrorMessage } from "../rules/ops-error-normalizer.rules";
import { OpsMetricsSamplingService } from "./ops-metrics-sampling.service";
import type { OpsMetricsWindowService } from "./ops-metrics-window.service";

export class OpsDashboardViewService {
  private constructor() {}

  static create(): OpsDashboardViewService {
    return new OpsDashboardViewService();
  }

  static buildPipelineTree({
    queues,
    seedKeys = [],
  }: {
    queues: QueueInfo[];
    seedKeys?: string[];
  }): PipelineNode[] {
    const pipelineMap = new Map<
      string,
      Map<string, Map<string, { pending: number; active: number; blocked: number }>>
    >();

    const ensurePath = (pName: string, jType?: string, jName?: string) => {
      if (!pipelineMap.has(pName)) {
        pipelineMap.set(pName, new Map());
      }

      if (jType) {
        const normalized = OpsMetricsSamplingService.normalizeJobType(jType);
        const typeMap = pipelineMap.get(pName)!;
        if (!typeMap.has(normalized)) {
          typeMap.set(normalized, new Map());
        }

        if (jName) {
          const nameMap = typeMap.get(normalized)!;
          if (!nameMap.has(jName)) {
            nameMap.set(jName, { pending: 0, active: 0, blocked: 0 });
          }
        }
      }
    };

    for (const key of seedKeys) {
      const parts = key.split("/");
      if (parts.length >= 1) {
        ensurePath(parts[0]!, parts[1], parts[2]);
      }
    }

    for (const queue of queues) {
      for (const group of queue.groups) {
        const pName = group.pipelineName ?? queue.displayName;
        const jType = OpsMetricsSamplingService.normalizeJobType(group.jobType ?? "default");
        const jName = group.jobName ?? "default";

        ensurePath(pName, jType, jName);
        const nameMap = pipelineMap.get(pName)!.get(jType)!;
        const existing = nameMap.get(jName)!;
        existing.pending += group.pendingJobs;
        existing.active += group.hasActiveJob ? 1 : 0;
        existing.blocked += group.isBlocked ? 1 : 0;
      }
    }

    const tree = OpsDashboardViewService.foldPipelineCounts(pipelineMap);
    tree.sort((a, b) => a.name.localeCompare(b.name));

    return tree;
  }

  /** Rolls the per-path counts up into the tree the sidebar renders, totals at every level. */
  private static foldPipelineCounts(
    pipelineMap: Map<
      string,
      Map<string, Map<string, { pending: number; active: number; blocked: number }>>
    >,
  ): PipelineNode[] {
    const tree: PipelineNode[] = [];
    for (const [pName, typeMap] of pipelineMap) {
      const typeChildren: PipelineNode[] = [];
      let pPending = 0,
        pActive = 0,
        pBlocked = 0;

      for (const [jType, nameMap] of typeMap) {
        const nameChildren: PipelineNode[] = [];
        let tPending = 0,
          tActive = 0,
          tBlocked = 0;

        for (const [jName, counts] of nameMap) {
          nameChildren.push({ name: jName, ...counts, children: [] });
          tPending += counts.pending;
          tActive += counts.active;
          tBlocked += counts.blocked;
        }

        typeChildren.push({
          name: jType,
          pending: tPending,
          active: tActive,
          blocked: tBlocked,
          children: nameChildren,
        });
        pPending += tPending;
        pActive += tActive;
        pBlocked += tBlocked;
      }

      tree.push({
        name: pName,
        pending: pPending,
        active: pActive,
        blocked: pBlocked,
        children: typeChildren,
      });
    }

    return tree;
  }

  static build({
    window,
    latestDetail,
    writerId,
    leaseEpoch,
  }: {
    window: OpsMetricsWindowService;
    latestDetail: DetailSnapshot | null;
    writerId: string;
    leaseEpoch: number;
  }): DashboardData {
    const fullQueues = window.latestQueues;
    const redisInfo = window.latestRedisInfo;

    const { totalGroups, blockedGroups, parkedGroups, totalPendingJobs } =
      OpsDashboardViewService.queueTotals(fullQueues);

    const treeSeedKeys = [...new Set([...window.currentPausedKeys, ...window.knownPipelinePaths])];
    const pipelineTree = OpsDashboardViewService.buildPipelineTree({
      queues: fullQueues,
      seedKeys: treeSeedKeys,
    });

    const topErrors = OpsDashboardViewService.topErrorsOf(fullQueues);

    const queues: QueueSummaryInfo[] = fullQueues.map(({ groups: _groups, ...summary }) => summary);

    return {
      totalGroups,
      blockedGroups,
      parkedGroups,
      totalPendingJobs,
      ...OpsDashboardViewService.ratesOf({ window, redisInfo }),
      throughputHistory: [...window.throughputBuffer],
      pipelineTree,
      queues,
      latencyP50Ms: window.currentLatencyP50Ms,
      latencyP99Ms: window.currentLatencyP99Ms,
      peakLatencyP50Ms: window.peakLatencyP50Ms,
      peakLatencyP99Ms: window.peakLatencyP99Ms,
      latencyWindows: latestDetail?.latencyWindows ?? null,
      phases: window.currentPhases,
      jobNameMetrics: window.currentJobNameMetrics,
      pausedKeys: window.currentPausedKeys,
      topErrors,
      // The writer's own view carries whatever its last detail cycle produced.
      // Readers get these from the persisted detail artifact instead; this path
      // exists so the writer can publish and so tests can drive it directly.
      parkedTenants: latestDetail?.parkedTenants ?? [],
      parkedTenantsBound: latestDetail?.parkedTenantsBound ?? {
        included: 0,
        total: 0,
      },
      errorClustersBound: latestDetail?.errorClustersBound ?? {
        included: topErrors.length,
        total: topErrors.length,
      },
      snapshot: {
        computedAt: Date.now(),
        detailComputedAt: latestDetail?.computedAt ?? null,
        writerId: writerId,
        leaseEpoch: leaseEpoch,
      },
    };
  }

  /** Every rate, peak and resource figure the header tiles read. */
  private static ratesOf({
    window,
    redisInfo,
  }: {
    window: OpsMetricsWindowService;
    redisInfo: RedisInfo;
  }): Pick<
    DashboardData,
    | "pendingDrift"
    | "throughputIngestedPerSec"
    | "totalCompleted"
    | "totalFailed"
    | "completedPerSec"
    | "failedPerSec"
    | "peakCompletedPerSec"
    | "peakFailedPerSec"
    | "peakIngestedPerSec"
    | "redisMemoryUsedBytes"
    | "redisMemoryPeakBytes"
    | "redisMemoryMaxBytes"
    | "redisConnectedClients"
    | "redisEngineCpuPercent"
    | "processCpuPercent"
    | "processMemoryUsedMb"
    | "processMemoryTotalMb"
  > {
    const mem = process.memoryUsage();

    return {
      pendingDrift: window.latestPendingDrift,
      throughputIngestedPerSec: window.currentIngestedPerSec,
      totalCompleted: window.latestTotalCompleted,
      totalFailed: window.latestTotalFailed,
      completedPerSec: window.currentCompletedPerSec,
      failedPerSec: window.currentFailedPerSec,
      peakCompletedPerSec: window.peakCompletedPerSec,
      peakFailedPerSec: window.peakFailedPerSec,
      peakIngestedPerSec: window.peakIngestedPerSec,
      redisMemoryUsedBytes: redisInfo.usedMemoryBytes,
      redisMemoryPeakBytes: redisInfo.peakMemoryBytes,
      redisMemoryMaxBytes: redisInfo.maxMemoryBytes,
      redisConnectedClients: redisInfo.connectedClients,
      redisEngineCpuPercent: window.currentRedisEngineCpuPercent,
      processCpuPercent: Math.round(window.currentCpuPercent * 10) / 10,
      processMemoryUsedMb: Math.round(mem.rss / 1024 / 1024),
      processMemoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    };
  }

  /** The blocked groups' errors, clustered by normalized message, worst first. */
  private static topErrorsOf(fullQueues: QueueInfo[]): Array<{
    normalizedMessage: string;
    sampleMessage: string;
    sampleStack: string | null;
    count: number;
    pipelineName: string | null;
    queueName: string;
    sampleGroupIds: string[];
  }> {
    const errorMap = new Map<
      string,
      {
        normalizedMessage: string;
        sampleMessage: string;
        sampleStack: string | null;
        count: number;
        pipelineName: string | null;
        queueName: string;
        sampleGroupIds: string[];
      }
    >();
    for (const q of fullQueues) {
      for (const g of q.groups) {
        if (!g.isBlocked || !g.errorMessage) {
          continue;
        }

        const normalized = normalizeErrorMessage(g.errorMessage);
        const key = `${g.pipelineName ?? ""}::${normalized}`;
        const existing = errorMap.get(key);
        if (existing) {
          existing.count++;
          if (existing.sampleGroupIds.length < 5) {
            existing.sampleGroupIds.push(g.groupId);
          }
        } else {
          errorMap.set(key, {
            normalizedMessage: normalized,
            sampleMessage: g.errorMessage,
            sampleStack: g.errorStack,
            count: 1,
            pipelineName: g.pipelineName,
            queueName: q.name,
            sampleGroupIds: [g.groupId],
          });
        }
      }
    }

    return Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /** The rollup across every scanned queue. */
  private static queueTotals(fullQueues: QueueInfo[]): {
    totalGroups: number;
    blockedGroups: number;
    parkedGroups: number;
    totalPendingJobs: number;
  } {
    let totalGroups = 0;
    let blockedGroups = 0;
    let parkedGroups = 0;
    let totalPendingJobs = 0;
    for (const queue of fullQueues) {
      totalGroups += queue.groups.length;
      blockedGroups += queue.blockedGroupCount;
      parkedGroups += queue.parkedGroupCount;
      totalPendingJobs += queue.totalPendingJobs;
    }

    return { totalGroups, blockedGroups, parkedGroups, totalPendingJobs };
  }
}
