import type { Trigger } from "@langwatch/automation-contract";
import { HandledError } from "@langwatch/handled-error";
import type { SlackApi, SlackConnectionClaim } from "@langwatch/slack-contract";
import { z } from "zod";

import type { TriggerRepository } from "../../../repositories/trigger.repository.ts";
import type { AutomationSlackConnectionService } from "./automation-slack-connection.service.ts";

/** How many Slack automations one claim page reads. */
const TRIGGER_PAGE_LIMIT = 500;

/** The connection a Slack automation's params name, read without a cast. */
const slackConnectionParamsSchema = z.object({ slackIntegrationId: z.string().nullish() });

/** Where a reconcile resumes: the phase it was in and the last position that phase finished. */
export const slackClaimReconcileCursorSchema = z.object({
  phase: z.enum(["claim", "release"]),
  after: z.string().nullable(),
});
export type SlackClaimReconcileCursor = z.infer<typeof slackClaimReconcileCursorSchema>;

/** What a reconcile did: connections claimed, claims skipped as unusable, released and kept. */
export interface SlackClaimReconcileCounts {
  claimed: number;
  skipped: number;
  released: number;
  kept: number;
}

/** Where a reconcile resumes, whether it writes, and who hears each finished page's cursor. */
export interface SlackClaimReconcileInput {
  from?: SlackClaimReconcileCursor;
  dryRun: boolean;
  signal?: AbortSignal;
  onPage?: (input: { cursor: SlackClaimReconcileCursor }) => Promise<void>;
}

type ReconcileTriggers = Pick<TriggerRepository, "findById" | "findActiveSlackTriggerPage">;
type ReconcileSlack = Pick<SlackApi, "listSlackConnectionClaims" | "releaseConnection">;
type ReconcileClaims = Pick<AutomationSlackConnectionService, "updateConnectionClaim">;

/** The connection a Slack automation's params name: one id, or none. */
function connectionIdsOf(trigger: Trigger): string[] {
  const params = slackConnectionParamsSchema.safeParse(trigger.actionParams ?? {});
  const id = params.success ? params.data.slackIntegrationId?.trim() : undefined;
  return id ? [id] : [];
}

/** Whether `trigger` is an active Slack automation still on the claimed connection. */
function holdsClaim({
  trigger,
  claim,
}: {
  trigger: Trigger | null;
  claim: SlackConnectionClaim;
}): boolean {
  if (!trigger || trigger.deleted || !trigger.active) return false;
  if (trigger.action !== "SEND_SLACK_MESSAGE") return false;
  return connectionIdsOf(trigger).includes(claim.connectionId);
}

function isUnusableConnection(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "slack_integration_missing";
}

/**
 * The Slack claim reconcile (DATA-AUTOMATION slice 2): claims every active Slack automation's
 * connection, then pages every claim slack holds and releases what no such automation holds.
 */
export class AutomationSlackClaimReconcileService {
  private constructor(
    private readonly deps: Readonly<{
      slack: ReconcileSlack;
      triggers: ReconcileTriggers;
      slackConnections: ReconcileClaims;
    }>,
  ) {}

  static create(deps: {
    slack: ReconcileSlack;
    triggers: ReconcileTriggers;
    slackConnections: ReconcileClaims;
  }): AutomationSlackClaimReconcileService {
    return new AutomationSlackClaimReconcileService(deps);
  }

  /** Idempotent; resumes from `from`; a dry run writes nothing and counts what it would. */
  async reconcile({
    from,
    dryRun,
    signal,
    onPage,
  }: SlackClaimReconcileInput): Promise<SlackClaimReconcileCounts> {
    const counts: SlackClaimReconcileCounts = { claimed: 0, skipped: 0, released: 0, kept: 0 };
    if (from?.phase !== "release") {
      const held = await this.heldClaims({ signal });
      const claimed = await this.claimActiveSlackTriggers({
        held,
        after: from?.after ?? undefined,
        dryRun,
        signal,
        onPage: (after) => onPage?.({ cursor: { phase: "claim", after } }) ?? Promise.resolve(),
      });
      counts.claimed = claimed.claimed;
      counts.skipped = claimed.skipped;
      await onPage?.({ cursor: { phase: "release", after: null } });
    }
    const resumeRelease = from?.phase === "release" ? (from.after ?? undefined) : undefined;
    const released = await this.releaseStaleClaims({
      after: resumeRelease,
      dryRun,
      signal,
      onPage: (after) => onPage?.({ cursor: { phase: "release", after } }) ?? Promise.resolve(),
    });
    return { ...counts, ...released };
  }

  /** Claims Slack holds, `connection|claimant` -> label: one already in place is not rewritten. */
  private async heldClaims({ signal }: { signal?: AbortSignal }): Promise<Map<string, string>> {
    const held = new Map<string, string>();
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await this.deps.slack.listSlackConnectionClaims({ after: cursor });
      for (const claim of page.claims) {
        held.set(`${claim.connectionId}|${claim.claimant.id}`, claim.claimant.label);
      }
      cursor = page.next ?? undefined;
    } while (cursor !== undefined);
    return held;
  }

  /** Claims each active Slack automation's connection; an unusable one is skipped and counted. */
  private async claimActiveSlackTriggers({
    held,
    after,
    dryRun,
    signal,
    onPage,
  }: {
    held: ReadonlyMap<string, string>;
    after?: string;
    dryRun: boolean;
    signal?: AbortSignal;
    onPage: (after: string) => Promise<void>;
  }): Promise<{ claimed: number; skipped: number }> {
    const counts = { claimed: 0, skipped: 0 };
    let cursor = after;
    let more = true;
    while (more) {
      signal?.throwIfAborted();
      const triggers = await this.deps.triggers.findActiveSlackTriggerPage({
        after: cursor,
        limit: TRIGGER_PAGE_LIMIT,
      });
      for (const trigger of triggers) {
        const [connectionId] = connectionIdsOf(trigger);
        if (connectionId === undefined) continue;
        if (held.get(`${connectionId}|${trigger.id}`) === trigger.name) continue;
        const outcome = dryRun ? "claimed" : await this.claim({ trigger });
        counts[outcome] += 1;
      }
      const last = triggers.at(-1);
      if (last) await onPage(last.id);
      more = last !== undefined && triggers.length === TRIGGER_PAGE_LIMIT;
      cursor = last?.id;
    }
    return counts;
  }

  private async claim({ trigger }: { trigger: Trigger }): Promise<"claimed" | "skipped"> {
    try {
      await this.deps.slackConnections.updateConnectionClaim({
        projectId: trigger.projectId,
        trigger: { id: trigger.id, name: trigger.name },
        before: undefined,
        after: { actionParams: trigger.actionParams, active: true },
      });
      return "claimed";
    } catch (error) {
      if (isUnusableConnection(error)) return "skipped";
      throw error;
    }
  }

  /** Releases every claim no active Slack automation of automation's own still holds. */
  private async releaseStaleClaims({
    after,
    dryRun,
    signal,
    onPage,
  }: {
    after?: string;
    dryRun: boolean;
    signal?: AbortSignal;
    onPage: (after: string | null) => Promise<void>;
  }): Promise<{ released: number; kept: number }> {
    const total = { released: 0, kept: 0 };
    let cursor = after;
    do {
      signal?.throwIfAborted();
      const page = await this.deps.slack.listSlackConnectionClaims({ after: cursor });
      const released = await this.releasePage({ claims: page.claims, dryRun });
      total.released += released;
      total.kept += page.claims.length - released;
      await onPage(page.next);
      cursor = page.next ?? undefined;
    } while (cursor !== undefined);
    return total;
  }

  private async releasePage({
    claims,
    dryRun,
  }: {
    claims: SlackConnectionClaim[];
    dryRun: boolean;
  }): Promise<number> {
    let released = 0;
    for (const claim of claims) {
      const trigger = await this.deps.triggers.findById({
        triggerId: claim.claimant.id,
        projectId: claim.projectId,
      });
      if (holdsClaim({ trigger, claim })) continue;
      if (!dryRun) {
        await this.deps.slack.releaseConnection({
          connectionId: claim.connectionId,
          projectId: claim.projectId,
          claimantId: claim.claimant.id,
        });
      }
      released += 1;
    }
    return released;
  }
}
