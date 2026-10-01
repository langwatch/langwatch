// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceObjectStore } from "../../app/governance.members.ts";

/** A source's bucket in memory: it lists and reads what a test seeded, in key order. */
export class MemoryObjectStoreChannel implements GovernanceObjectStore {
  private readonly objects = new Map<string, string>();

  private constructor() {}

  static create(): MemoryObjectStoreChannel {
    return new MemoryObjectStoreChannel();
  }

  seed({ bucket, key, text }: { bucket: string; key: string; text: string }): void {
    this.objects.set(`${bucket}/${key}`, text);
  }

  async list(
    input: Parameters<GovernanceObjectStore["list"]>[0],
  ): Promise<{ keys: string[]; isTruncated: boolean }> {
    const keys = [...this.objects.keys()]
      .filter((path) => path.startsWith(`${input.bucket}/${input.prefix}`))
      .map((path) => path.slice(input.bucket.length + 1))
      .filter((key) => input.startAfter === undefined || key > input.startAfter)
      .toSorted();
    return { keys: keys.slice(0, input.limit), isTruncated: keys.length > input.limit };
  }

  async readText(input: Parameters<GovernanceObjectStore["readText"]>[0]): Promise<string> {
    const text = this.objects.get(`${input.bucket}/${input.key}`);
    if (text === undefined) throw new Error(`no object at s3://${input.bucket}/${input.key}`);
    if (new TextEncoder().encode(text).byteLength > input.maxBytes) {
      throw new Error(`file exceeds ${input.maxBytes} bytes: s3://${input.bucket}/${input.key}`);
    }
    return text;
  }
}
