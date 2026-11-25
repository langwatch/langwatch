import type { RecentItem } from "@langwatch/audit-log-contract";
import { toDate } from "@langwatch/time";

import type { RecentTouchRepository } from "../repositories/recent-touch.repository.ts";
import {
  deriveTouchFetchLimit,
  pickRecentEntities,
  RECENT_ACTION_PREFIXES,
} from "../rules/recent-items.rules.ts";

/** The caller's recent touches; the browser names and links each from its owner's list (R6). */
export class RecentItemsService {
  readonly #touches: RecentTouchRepository;

  private constructor({ touches }: { touches: RecentTouchRepository }) {
    this.#touches = touches;
  }

  static create(options: { touches: RecentTouchRepository }): RecentItemsService {
    return new RecentItemsService(options);
  }

  async getRecentItems(input: {
    userId: string;
    projectId: string;
    limit: number;
  }): Promise<RecentItem[]> {
    const touches = await this.#touches.findRecentTouches({
      userId: input.userId,
      projectId: input.projectId,
      actionPrefixes: RECENT_ACTION_PREFIXES,
      limit: deriveTouchFetchLimit(input.limit),
    });

    return pickRecentEntities({ touches, limit: input.limit })
      .filter((entity) => entity.type !== "simulation")
      .map((entity) => ({ id: entity.id, type: entity.type, updatedAt: toDate(entity.touchedAt) }));
  }
}
