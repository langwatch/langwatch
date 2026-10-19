import type {
  PinSource,
  PinTraceInput,
  PinnedTrace,
  UnpinTraceInput,
} from "@langwatch/data-retention-contract";

export interface PinnedTraceRepository {
  findByProjectAndTrace(input: UnpinTraceInput): Promise<PinnedTrace | null>;
  findAllByProject(input: { projectId: string }): Promise<PinnedTrace[]>;
  findAllTraceIds(input: { projectId: string }): Promise<string[]>;
  create(input: PinTraceInput & { source: PinSource }): Promise<PinnedTrace>;
  delete(input: UnpinTraceInput): Promise<void>;
  hasManualPin(input: UnpinTraceInput): Promise<boolean>;
}
