import { Readable } from "node:stream";

import type { TraceLegacySpool } from "../trace-legacy-spool.channel.ts";

/** Holds v1 spool objects by key; a missing key reads as the no-body refusal S3 gives. */
export class MemoryTraceLegacySpoolChannel implements TraceLegacySpool {
  readonly objects = new Map<string, Buffer>();

  static create(): MemoryTraceLegacySpoolChannel {
    return new MemoryTraceLegacySpoolChannel();
  }

  private constructor() {}

  async openRead({ key }: { projectId: string; key: string }): Promise<Readable> {
    const body = this.objects.get(key);
    if (!body) {
      throw new Error(`Spool object returned no body (key=${key}) — cannot reconstitute command`);
    }

    return Readable.from([body]);
  }

  async delete({ key }: { projectId: string; key: string }): Promise<void> {
    this.objects.delete(key);
  }
}
