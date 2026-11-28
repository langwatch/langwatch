import { type AccessNoticePush, AccessNoticePushChannel } from "../access-notice-push.channel.ts";

/** Records each seat request push once per idempotency key, as delivery does, and sends nothing. */
export class MemoryAccessNoticePushChannel extends AccessNoticePushChannel {
  static create(): MemoryAccessNoticePushChannel {
    return new MemoryAccessNoticePushChannel();
  }

  readonly pushes: AccessNoticePush[] = [];
  /** Set to make every push fail, as a notification service that is down would. */
  failPushes = false;

  private constructor() {
    super();
  }

  async push(input: AccessNoticePush): Promise<void> {
    if (this.failPushes) throw new Error("push is down");
    if (this.pushes.some((sent) => sent.idempotencyKey === input.idempotencyKey)) return;
    this.pushes.push(input);
  }
}
