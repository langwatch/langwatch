// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { nowInstant } from "@langwatch/time";

import type {
  SecurityLakeQueue,
  SecurityLakeQueueMessage,
} from "../security-lake-queue.channel.ts";

type StoredMessage = {
  body: string;
  receiveCount: number;
  /** When the message can be received again; a receive hides it until then. */
  visibleAtMs: number;
  /** The handle of the latest receive; an older handle no longer deletes or extends it. */
  receiptHandle: string | undefined;
};

/**
 * A subscriber queue in memory with SQS's at-least-once shape: a received message is hidden for
 * the visibility timeout, then comes back with its count raised and a new receipt handle. Like SQS,
 * a delete with a superseded handle leaves the message, and an extension past expiry is refused.
 */
export class MemorySecurityLakeQueueChannel implements SecurityLakeQueue {
  private readonly messages = new Map<string, StoredMessage>();
  private sequence = 0;
  readonly deleted: string[] = [];

  private constructor(
    private readonly visibilityTimeoutMs: number,
    private readonly now: () => number,
  ) {}

  static create({
    visibilityTimeoutMs = 30_000,
    now = () => nowInstant().epochMilliseconds,
  }: { visibilityTimeoutMs?: number; now?: () => number } = {}): MemorySecurityLakeQueueChannel {
    return new MemorySecurityLakeQueueChannel(visibilityTimeoutMs, now);
  }

  send({ body }: { body: string }): string {
    this.sequence += 1;
    const messageId = `message-${this.sequence}`;
    this.messages.set(messageId, {
      body,
      receiveCount: 0,
      visibleAtMs: Number.NEGATIVE_INFINITY,
      receiptHandle: undefined,
    });
    return messageId;
  }

  /** Every message still on the queue, hidden or not. */
  pending(): string[] {
    return [...this.messages.keys()];
  }

  async probe(): Promise<{ waiting: number; inFlight: number }> {
    const now = this.now();
    const inFlight = [...this.messages.values()].filter((m) => m.visibleAtMs > now).length;
    return { waiting: this.messages.size - inFlight, inFlight };
  }

  async receive({ maxMessages }: { maxMessages: number }): Promise<SecurityLakeQueueMessage[]> {
    const now = this.now();
    return [...this.messages.entries()]
      .filter(([, message]) => message.visibleAtMs <= now)
      .slice(0, maxMessages)
      .map(([messageId, message]) => {
        message.receiveCount += 1;
        message.visibleAtMs = now + this.visibilityTimeoutMs;
        message.receiptHandle = `${messageId}#${message.receiveCount}`;
        return {
          messageId,
          receiptHandle: message.receiptHandle,
          body: message.body,
          receiveCount: message.receiveCount,
        };
      });
  }

  async delete({ receiptHandle }: { receiptHandle: string }): Promise<void> {
    const found = this.findByHandle(receiptHandle);
    if (found === undefined) return;
    this.messages.delete(found);
    this.deleted.push(found);
  }

  async changeVisibility({
    receiptHandle,
    visibilityTimeoutSeconds,
  }: {
    receiptHandle: string;
    visibilityTimeoutSeconds: number;
  }): Promise<void> {
    const found = this.findByHandle(receiptHandle);
    const message = found === undefined ? undefined : this.messages.get(found);
    const now = this.now();
    if (message === undefined || message.visibleAtMs <= now) {
      throw new Error("ReceiptHandleIsInvalid: the message is no longer held by this handle");
    }
    message.visibleAtMs = now + visibilityTimeoutSeconds * 1000;
  }

  private findByHandle(receiptHandle: string): string | undefined {
    for (const [messageId, message] of this.messages) {
      if (message.receiptHandle === receiptHandle) return messageId;
    }
    return undefined;
  }
}
