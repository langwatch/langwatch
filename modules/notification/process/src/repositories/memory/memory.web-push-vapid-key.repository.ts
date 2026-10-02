import type { VapidKeyPair, WebPushVapidKeyRepository } from "../web-push-vapid-key.repository.ts";

export class MemoryWebPushVapidKeyRepository implements WebPushVapidKeyRepository {
  #pair: VapidKeyPair | null = null;

  private constructor() {}

  static create(): MemoryWebPushVapidKeyRepository {
    return new MemoryWebPushVapidKeyRepository();
  }

  async find(): Promise<VapidKeyPair | null> {
    return this.#pair ? { ...this.#pair } : null;
  }

  async insertIfAbsent(pair: VapidKeyPair): Promise<VapidKeyPair> {
    this.#pair ??= { ...pair };
    return { ...this.#pair };
  }
}
