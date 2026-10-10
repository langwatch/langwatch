import type { Instant } from "@langwatch/time";

import {
  AutomationEmailCapRepository,
  type EmailCapClaim,
  type EmailCapSend,
} from "../automation-email-cap.repository.ts";

type Window = { count: number; expiresAt: number };

const SWEEP_AT_ENTRIES = 1_000;

/** The email ceilings, counted by this process; each operation settles before it yields. */
export class MemoryAutomationEmailCapRepository extends AutomationEmailCapRepository {
  static create(): MemoryAutomationEmailCapRepository {
    return new MemoryAutomationEmailCapRepository();
  }

  private readonly claims = new Map<string, number>();
  private readonly windows = new Map<string, Window>();

  private constructor() {
    super();
  }

  claimSend(send: EmailCapSend): Promise<EmailCapClaim> {
    const now = send.now.epochMilliseconds;
    this.sweep(now);
    const claimHeldUntil = this.claims.get(send.claim);
    if (claimHeldUntil !== undefined && claimHeldUntil > now) {
      return Promise.resolve({ outcome: "already-counted" });
    }

    const expiresAt = now + send.ttlSeconds * 1_000;
    this.claims.set(send.claim, expiresAt);
    const window = this.openWindow(send.window, now) ?? { count: 0, expiresAt };
    window.count += send.sends;
    this.windows.set(send.window, window);
    return Promise.resolve({ outcome: "counted", count: window.count });
  }

  countSends(input: Readonly<{ window: string; now: Instant }>): Promise<number> {
    return Promise.resolve(this.openWindow(input.window, input.now.epochMilliseconds)?.count ?? 0);
  }

  private openWindow(window: string, now: number): Window | undefined {
    const held = this.windows.get(window);
    return held !== undefined && held.expiresAt > now ? held : undefined;
  }

  private sweep(now: number): void {
    if (this.claims.size + this.windows.size < SWEEP_AT_ENTRIES) return;
    for (const [claim, heldUntil] of this.claims) {
      if (heldUntil <= now) this.claims.delete(claim);
    }
    for (const [window, held] of this.windows) {
      if (held.expiresAt <= now) this.windows.delete(window);
    }
  }
}
