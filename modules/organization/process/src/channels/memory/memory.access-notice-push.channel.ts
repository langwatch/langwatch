import { type AccessNoticePush, AccessNoticePushChannel } from "../access-notice-push.channel.ts";

/** Records each seat request push it is handed and sends nothing. */
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
    this.pushes.push(input);
  }
}
