import { setTimeout as sleep } from "node:timers/promises";
import type { AutomationService, TriggerSummary } from "@langwatch/automation-contract";
import { DispatchError, isDispatchError, pMapLimited } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { Project, ProjectService } from "@langwatch/project-contract";
import type { TraceService } from "@langwatch/trace-contract";
import type { AutomationClock } from "../ports/automation-clock.port";
import type {
  AutomationSettlementMatchConfirmationPort,
  AutomationSettlementObservabilityPort,
} from "../ports/automation-settlement.port";
import type { AutomationPersistActionService } from "./persist-action.service";

const logger = createLogger("langwatch:automation:settlement-persistence");
const CONFIRM_CONCURRENCY = 4;
const CLAIM_RETRY_DELAYS_MS = [200, 500];

type PersistenceComposition = {
  automation: AutomationService;
  projects: ProjectService;
  traces: TraceService;
  confirmation: AutomationSettlementMatchConfirmationPort;
  persistActions: AutomationPersistActionService;
  clock: AutomationClock;
  observability: AutomationSettlementObservabilityPort;
};

type PersistPage = {
  projectId: string;
  triggerId: string;
  trigger: TriggerSummary;
  project: Project;
  cap: number;
  breachReported: boolean;
  unclaimed: string[];
  retryableFailures: unknown[];
};

export class TriggerSettlementPersistenceService {
  private constructor(private readonly composition: PersistenceComposition) {}

  static create(composition: PersistenceComposition): TriggerSettlementPersistenceService {
    return new TriggerSettlementPersistenceService(composition);
  }

  async dispatch(input: {
    projectId: string;
    triggerId: string;
    traceIds: string[];
  }): Promise<void> {
    const trigger = await this.tryGetTrigger(input);
    if (!trigger) {
      return;
    }

    const uniqueTraceIds = [...new Set(input.traceIds)];
    const alreadySent = await this.composition.automation.filterSendClaimed({
      triggerId: input.triggerId,
      traceIds: uniqueTraceIds,
      projectId: input.projectId,
    });
    const remaining = uniqueTraceIds.filter((traceId) => !alreadySent.has(traceId));
    if (remaining.length === 0) {
      return;
    }

    const project = await this.composition.projects.tryGetById(input.projectId);
    if (!project) {
      throw new DispatchError({
        message: `project ${input.projectId} not found at dispatch time`,
        retryable: false,
      });
    }

    const page: PersistPage = {
      projectId: input.projectId,
      triggerId: input.triggerId,
      trigger,
      project,
      cap: await this.composition.automation.resolvePersistDailyCap(input.projectId),
      breachReported: false,
      unclaimed: [],
      retryableFailures: [],
    };

    await pMapLimited({
      items: remaining,
      concurrency: CONFIRM_CONCURRENCY,
      fn: async (traceId) => {
        try {
          await this.dispatchTrace(page, traceId);
        } catch (error) {
          this.recordTraceFailure(page, traceId, error);
        }
      },
    });

    this.throwIfPageShouldRetry(page, remaining.length);
  }

  private async tryGetTrigger(input: {
    projectId: string;
    triggerId: string;
    traceIds: string[];
  }): Promise<TriggerSummary | null> {
    const triggers = await this.composition.automation.getActiveTraceTriggersForProject(
      input.projectId,
    );
    const trigger = triggers.find(({ id }) => id === input.triggerId) ?? null;
    if (!trigger) {
      logger.info(
        {
          projectId: input.projectId,
          triggerId: input.triggerId,
          pageSize: input.traceIds.length,
        },
        "Trigger gone / deactivated since match — dropping persist dispatch",
      );
    }

    return trigger;
  }

  private async dispatchTrace(page: PersistPage, traceId: string): Promise<void> {
    const foldState = await this.composition.traces.tryGetSummary({
      projectId: page.projectId,
      traceId,
    });
    if (!foldState) {
      logger.debug(
        { projectId: page.projectId, triggerId: page.triggerId, traceId },
        "Trace fold gone before persist dispatch — skipping match",
      );

      return;
    }

    const confirmed = await this.composition.confirmation.confirms({
      trigger: page.trigger,
      projectId: page.projectId,
      traceId,
      foldState,
    });
    if (!confirmed) {
      return;
    }

    const allowed = await this.allowedByDailyCeiling(page, traceId);
    if (!allowed) {
      return;
    }

    await this.composition.persistActions.dispatch({
      trigger: page.trigger,
      traceId,
      tenantId: page.projectId,
      project: page.project,
    });
    await this.claimDispatch(page, traceId);
  }

  private async allowedByDailyCeiling(page: PersistPage, traceId: string): Promise<boolean> {
    const slot = await this.composition.automation.consumePersistCapSlot({
      projectId: page.projectId,
      triggerId: page.triggerId,
      dedupKey: `${page.projectId}/${page.triggerId}:persist:${traceId}`,
      now: this.composition.clock.now(),
      cap: page.cap,
    });
    if (slot.allowed) {
      return true;
    }

    logger.warn(
      {
        projectId: page.projectId,
        triggerId: page.triggerId,
        traceId,
        count: slot.count,
        cap: slot.cap,
      },
      "Automation passed its daily match ceiling — skipping this match for the UTC day",
    );
    if (page.breachReported) {
      return false;
    }

    page.breachReported = true;

    try {
      await this.composition.automation.handlePersistCapBreach({
        trigger: page.trigger,
        projectId: page.projectId,
        count: slot.count,
        cap: slot.cap,
        skipped: slot.skipped,
      });
    } catch (error) {
      this.capture(error, {
        projectId: page.projectId,
        triggerId: page.triggerId,
        phase: "persist-cap-breach",
      });
    }

    return false;
  }

  private async claimDispatch(page: PersistPage, traceId: string): Promise<void> {
    const attempts = CLAIM_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.composition.automation.claimSend({
          triggerId: page.triggerId,
          traceId,
          projectId: page.projectId,
        });

        return;
      } catch (error) {
        const waitMs = CLAIM_RETRY_DELAYS_MS[attempt];
        if (waitMs !== void 0) {
          await sleep(waitMs);
          continue;
        }

        page.unclaimed.push(traceId);
        this.capture(error, {
          projectId: page.projectId,
          triggerId: page.triggerId,
          traceId,
          attempts,
          phase: "claimSend-post-persist-dispatch",
        });
      }
    }
  }

  private recordTraceFailure(page: PersistPage, traceId: string, error: unknown): void {
    const retryable = isDispatchError(error) ? error.retryable : true;
    if (retryable) {
      page.retryableFailures.push(error);

      return;
    }

    this.capture(error, {
      projectId: page.projectId,
      triggerId: page.triggerId,
      traceId,
      phase: "persist-dispatch-terminal",
    });
  }

  private throwIfPageShouldRetry(page: PersistPage, pageSize: number): void {
    if (page.retryableFailures.length === 0) {
      return;
    }

    if (page.unclaimed.length > 0) {
      this.composition.observability.capture(
        new Error("Persist page retry re-runs traces that hold no claim"),
        {
          projectId: page.projectId,
          triggerId: page.triggerId,
          pageSize,
          unclaimed: page.unclaimed,
          phase: "persist-page-retry-unclaimed",
        },
      );
    }

    const representative = page.retryableFailures[0];
    logger.warn(
      {
        projectId: page.projectId,
        triggerId: page.triggerId,
        failed: page.retryableFailures.length,
        pageSize,
        errorType: representative instanceof Error ? representative.name : typeof representative,
        errorMessage:
          representative instanceof Error ? representative.message : String(representative),
      },
      "Persist page had retryable failures. Retrying the page; claimed traces no-op on the retry",
    );

    throw representative;
  }

  private capture(error: unknown, context: Record<string, unknown>): void {
    const handled = error instanceof Error ? error : new Error(String(error));
    logger.error({ ...context, error: handled.message }, "Persist dispatch failed terminally");
    this.composition.observability.capture(handled, context);
  }
}
