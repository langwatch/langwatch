import {
  type LangyFrameDedupRepository,
  type LangyResourceLinksRepository,
  type LangyTurnAccess,
  LangyTurnAccessPort,
  type LangyTurnHandoff,
  LangyTurnHandoffPort,
  langyTurnAccessSchema,
  langyTurnHandoffSchema,
} from "../langy-live-turn.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** Who may watch a turn, held for the life of the process. */
export class LangyTurnAccessMemoryRepository extends LangyTurnAccessPort {
  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  static create(store: LangyMemoryStore): LangyTurnAccessMemoryRepository {
    return new LangyTurnAccessMemoryRepository(store);
  }

  async grant(access: LangyTurnAccess): Promise<void> {
    const parsed = langyTurnAccessSchema.parse(access);
    this.store.turnAccess.set(this.store.turnKey(parsed), parsed);
  }

  async isTurnActor(access: LangyTurnAccess): Promise<boolean> {
    const stored = this.store.turnAccess.get(this.store.turnKey(access));
    if (!stored) return false;
    return stored.projectId === access.projectId && stored.userId === access.userId;
  }
}

/** The parked handoff a worker picks a turn up from. */
export class LangyTurnHandoffMemoryRepository extends LangyTurnHandoffPort {
  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  static create(store: LangyMemoryStore): LangyTurnHandoffMemoryRepository {
    return new LangyTurnHandoffMemoryRepository(store);
  }

  async stash(handoff: LangyTurnHandoff): Promise<void> {
    const parsed = langyTurnHandoffSchema.parse(handoff);
    this.store.handoffs.set(this.store.turnKey(parsed), parsed);
  }

  async read(input: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnHandoff | null> {
    return this.store.handoffs.get(this.store.turnKey(input)) ?? null;
  }

  async refresh(input: { conversationId: string; turnId: string }): Promise<boolean> {
    return this.store.handoffs.has(this.store.turnKey(input));
  }

  async markStopped(input: { conversationId: string; turnId: string }): Promise<void> {
    this.store.stoppedTurns.add(this.store.turnKey(input));
  }

  async isStopped(input: { conversationId: string; turnId: string }): Promise<boolean> {
    return this.store.stoppedTurns.has(this.store.turnKey(input));
  }
}

/** Frame nonces already seen for a turn. */
export class LangyFrameDedupMemoryRepository implements LangyFrameDedupRepository {
  private constructor(private readonly store: LangyMemoryStore) {}

  static create(store: LangyMemoryStore): LangyFrameDedupMemoryRepository {
    return new LangyFrameDedupMemoryRepository(store);
  }

  async reserveFrameNonce(input: {
    conversationId: string;
    turnId: string;
    frameNonce: string;
  }): Promise<boolean> {
    const key = `${this.store.turnKey(input)}:${input.frameNonce}`;
    if (this.store.seenFrames.has(key)) return false;
    this.store.seenFrames.add(key);
    return true;
  }
}

/** The links a navigate command resolves an id against. */
export class LangyResourceLinksMemoryRepository implements LangyResourceLinksRepository {
  private constructor(private readonly store: LangyMemoryStore) {}

  static create(store: LangyMemoryStore): LangyResourceLinksMemoryRepository {
    return new LangyResourceLinksMemoryRepository(store);
  }

  async remember(input: {
    conversationId: string;
    links: Array<{ id: string; href: string }>;
  }): Promise<void> {
    const links = this.store.resourceLinks.get(input.conversationId) ?? new Map<string, string>();
    for (const link of input.links) links.set(link.id, link.href);
    this.store.resourceLinks.set(input.conversationId, links);
  }

  async resolve(input: { conversationId: string; id: string }): Promise<string | null> {
    return this.store.resourceLinks.get(input.conversationId)?.get(input.id) ?? null;
  }
}
