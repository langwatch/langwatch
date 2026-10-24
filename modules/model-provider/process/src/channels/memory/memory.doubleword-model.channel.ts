import { DoublewordModelChannel, type DoublewordModelList } from "../doubleword-model.channel.ts";

const NOTHING_BOUND: DoublewordModelList = {
  outcome: "unavailable",
  reason: "transport_failed",
  detail: "no Doubleword model list is bound to this memory channel",
};

/** A twin with no model list behind it unless a test hands it one. */
export class MemoryDoublewordModelChannel extends DoublewordModelChannel {
  private constructor(private readonly list: DoublewordModelList) {
    super();
  }

  static create({
    list = NOTHING_BOUND,
  }: { list?: DoublewordModelList } = {}): MemoryDoublewordModelChannel {
    return new MemoryDoublewordModelChannel(list);
  }

  async fetchModels(_input: { apiKey: string }): Promise<DoublewordModelList> {
    return this.list;
  }
}
