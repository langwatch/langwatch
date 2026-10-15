import {
  permissionCardEntry,
  questionCardEntry,
  type StoredUserWait,
  type UserWaitBuffer,
} from "../../../rules/langy-local-user-wait-record.rules.ts";
import { LANGY_LIVENESS } from "../../../rules/langy-streaming-constants.rules.ts";

interface UserWaitCardsOptions {
  buffer: UserWaitBuffer;
  now: () => number;
}

/** What a user wait shows on the turn's live stream: its card, its status line, its liveness. */
export class UserWaitCardsService {
  static create(options: UserWaitCardsOptions): UserWaitCardsService {
    return new UserWaitCardsService(options);
  }

  private constructor(private readonly options: UserWaitCardsOptions) {}

  /**
   * The liveness gate of one poll request: it refreshes on the first pass,
   * then once per heartbeat interval for as long as the request holds. The
   * request is the worker's own, so a worker that stopped stops refreshing.
   */
  beater(): (wait: StoredUserWait) => Promise<void> {
    let lastBeatAt: number | null = null;

    return async (wait) => {
      const now = this.options.now();
      const due = lastBeatAt === null || now - lastBeatAt >= LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS;
      if (!due) {
        return;
      }

      lastBeatAt = now;
      await this.options.buffer.heartbeat({
        conversationId: wait.conversationId,
        turnId: wait.turnId,
        now,
      });
    };
  }

  /** The status line behind the card, whose only job is to push the stream's expiry out. */
  async appendWaitingStatus(wait: StoredUserWait): Promise<void> {
    await this.options.buffer.appendStatus({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      status:
        wait.kind === "permission"
          ? "Waiting for your answer on the permission card"
          : "Waiting for your answer",
    });
  }

  async publishPermission(wait: StoredUserWait): Promise<void> {
    if (!wait.callId) {
      return;
    }

    await this.options.buffer.appendLocalPermission({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      entry: permissionCardEntry({ wait, callId: wait.callId }),
    });
  }

  async publishQuestion(wait: StoredUserWait): Promise<void> {
    await this.options.buffer.appendQuestion({
      conversationId: wait.conversationId,
      turnId: wait.turnId,
      entry: questionCardEntry(wait),
    });
  }
}
