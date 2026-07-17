import type {
  HandleResult,
  ProcessEventEnvelope,
} from "~/server/event-sourcing/process-manager";

/** The slice of ProcessManagerService the match subscribers need — injected
 *  so the adapters have no construction or persistence concerns. */
export interface TriggerSettlementProcessPort {
  handleEvent(params: {
    envelope: ProcessEventEnvelope;
    now: number;
  }): Promise<HandleResult>;
}
