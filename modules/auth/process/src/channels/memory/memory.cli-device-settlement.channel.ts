import { CliDeviceSettlementChannel } from "../cli-device-settlement.channel.ts";

/** Settlements heard inside one process: the memory tier and every test's. */
export class MemoryCliDeviceSettlementChannel extends CliDeviceSettlementChannel {
  readonly #listeners = new Map<string, Set<(status: string) => void>>();

  private constructor() {
    super();
  }

  static create(): MemoryCliDeviceSettlementChannel {
    return new MemoryCliDeviceSettlementChannel();
  }

  async publish({ deviceCode, status }: { deviceCode: string; status: string }): Promise<void> {
    for (const listener of this.#listeners.get(deviceCode) ?? []) listener(status);
  }

  async listen({
    deviceCode,
    onSettled,
  }: {
    deviceCode: string;
    onSettled: (status: string) => void;
  }): Promise<() => void> {
    const listeners = this.#listeners.get(deviceCode) ?? new Set();
    listeners.add(onSettled);
    this.#listeners.set(deviceCode, listeners);

    return () => {
      listeners.delete(onSettled);
      if (listeners.size === 0) this.#listeners.delete(deviceCode);
    };
  }
}
