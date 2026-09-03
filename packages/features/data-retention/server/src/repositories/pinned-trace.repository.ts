import type {
  PinSource,
  PinTraceInput,
  PinnedTrace,
  UnpinTraceInput,
} from "@langwatch/data-retention-contract";

export abstract class PinnedTraceRepository {
  abstract tryFindByProjectAndTrace(input: UnpinTraceInput): Promise<PinnedTrace | null>;
  abstract findAllByProject(input: { projectId: string }): Promise<PinnedTrace[]>;
  abstract findAllTraceIds(input: { projectId: string }): Promise<string[]>;
  abstract create(input: PinTraceInput & { source: PinSource }): Promise<PinnedTrace>;
  abstract delete(input: UnpinTraceInput): Promise<void>;
  abstract hasManualPin(input: UnpinTraceInput): Promise<boolean>;
}
