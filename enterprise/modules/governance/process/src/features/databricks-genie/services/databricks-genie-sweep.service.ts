// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie sweep: spaces, then each space's conversations, resumable across runs. */

import type {
  DatabricksGeniePullConfig,
  NormalizedPullEvent,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import type { GenieCursor } from "../rules/databricks-genie-cursor.rules.ts";
import {
  type conversationSchema,
  conversationsPageSchema,
  type GenieIdentity,
} from "../rules/databricks-genie-message-event.rules.ts";
import {
  conversationWalkPlan,
  earlierOf,
  type PagedRead,
  type SpaceRead,
  spaceWalkPlan,
  type SweepResult,
  sweptUpTo,
} from "../rules/databricks-genie-sweep.rules.ts";
import { GENIE_SPACES_PATH, walkGenieSpaces } from "../rules/genie-spaces.rules.ts";
import type { GenieSpace } from "../rules/genie-spaces.rules.ts";
import type { DatabricksGenieConversationService } from "./databricks-genie-conversation.service.ts";
import type { DatabricksGenieRunBudgetService } from "./databricks-genie-run-budget.service.ts";
import {
  type DatabricksGenieWorkspaceService,
  PAGE_SIZE,
} from "./databricks-genie-workspace.service.ts";
import type { DatabricksWarehouseCostService } from "./puller-databricks-warehouse-cost.service.ts";

export class DatabricksGenieSweepService {
  private constructor(
    private readonly workspace: DatabricksGenieWorkspaceService,
    private readonly conversations: DatabricksGenieConversationService,
    private readonly warehouseCosts: DatabricksWarehouseCostService,
  ) {}

  static create({
    workspace,
    conversations,
    warehouseCosts,
  }: {
    workspace: DatabricksGenieWorkspaceService;
    conversations: DatabricksGenieConversationService;
    warehouseCosts: DatabricksWarehouseCostService;
  }): DatabricksGenieSweepService {
    return new DatabricksGenieSweepService(workspace, conversations, warehouseCosts);
  }

  /**
   * Walks spaces → conversations → messages, keeping everything it manages to
   * read and reporting whether it read all of it.
   *
   * Each space, and each conversation within it, is isolated. One space the
   * credential cannot see must not cost the workspace the other five: this API
   * has no partial-failure response, so a 403 on space four would otherwise
   * unwind the run and discard three spaces' worth of already-read messages,
   * forever, because the next run would hit the same 403 at the same point.
   *
   * A failure does still suppress the watermark, so nothing behind the broken
   * space is skipped — the cost of a permanently unreadable space is a sweep
   * that keeps re-reading the rest, which is loud and lossless rather than
   * quiet and lossy.
   */
  async sweep({
    config,
    token,
    options,
    budget,
    cursor,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    cursor: GenieCursor;
  }): Promise<SweepResult> {
    // One SCIM lookup per author per run, not per message. A conversation is
    // many messages by one person, so the naive version would ask the identity
    // provider the same question dozens of times inside one sweep.
    const identities = new Map<number, GenieIdentity>();
    const spaces = await this.resolveSpaces({ config, token, options, budget });

    const spacePlan = spaceWalkPlan({
      spaces,
      resumeSpaceId: cursor.spaceId,
      resumeFingerprint: cursor.spaceSetFingerprint,
    });
    return this.walkSpaces({
      config,
      token,
      options,
      budget,
      cursor,
      spacePlan,
      identities,
      listingComplete: spaces.complete,
    });
  }

  /** The planned spaces from the resume point on, stopping when the budget runs out. */
  private async walkSpaces({
    config,
    token,
    options,
    budget,
    cursor,
    spacePlan,
    identities,
    listingComplete,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    cursor: GenieCursor;
    spacePlan: ReturnType<typeof spaceWalkPlan>;
    identities: Map<number, GenieIdentity>;
    listingComplete: boolean;
  }): Promise<SweepResult> {
    const events: NormalizedPullEvent[] = [];
    let complete = listingComplete;

    // Seeded from the sweep already in flight, so this means "this SWEEP walked
    // past something", not "this run did". The resume point keeps moving
    // forward so the rest of the workspace still gets swept; this is what stops
    // the watermark once the sweep finally finishes.
    let hadGap = cursor.sweepHadGap;
    // Seeded from the sweep in flight for the same reason as `hadGap`.
    let oldestPendingMs: number | null = cursor.sweepOldestPendingMs;
    for (let i = spacePlan.startAt; i < spacePlan.ordered.length; i += 1) {
      const space = spacePlan.ordered[i]!;
      // Only the space the cursor actually stopped in inherits the conversation
      // resume point. Every space after it is taken from the top.
      const resumeConversationId = space.space_id === cursor.spaceId ? cursor.conversationId : null;

      if (budget.exhausted()) {
        // Everything read so far is kept and the watermark is held. The
        // conversation position is handed back rather than dropped, so a run
        // that ends before it could touch this space does not undo the progress
        // an earlier run already made inside it.
        return sweptUpTo({
          events,
          space,
          at: resumeConversationId,
          hadGap,
          oldestPendingMs,
          spacePlan,
        });
      }

      const read = await this.readSpace({
        config,
        token,
        options,
        budget,
        cursor,
        space,
        identities,
        resumeConversationId,
      });
      events.push(...read.items);
      complete = complete && read.complete;
      // A gap inside the space, or this whole space unreadable. Either way the
      // sweep is about to move past something it never saw.
      hadGap = hadGap || read.hadGap;
      if (read.oldestPendingMs !== null) {
        oldestPendingMs = earlierOf(oldestPendingMs, read.oldestPendingMs);
      }

      // Out of budget with this space unfinished — resume ON it, so its tail is
      // re-read rather than half-skipped. `read.resumeConversationId` narrows
      // that re-read to where it stopped, which is what lets a space bigger
      // than one run's whole budget finish across several runs.
      if (!read.complete && budget.exhausted()) {
        return sweptUpTo({
          events,
          space,
          at: read.resumeConversationId,
          hadGap,
          oldestPendingMs,
          spacePlan,
        });
      }
    }

    return {
      events,
      complete,
      resumeSpaceId: null,
      resumeConversationId: null,
      hadGap,
      oldestPendingMs,
      spaceSetFingerprint: spacePlan.fingerprint,
    };
  }

  /** One space's new messages, read from as far back as the source's cost read needs. */
  private readSpace({
    config,
    token,
    options,
    budget,
    cursor,
    space,
    identities,
    resumeConversationId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    cursor: GenieCursor;
    space: GenieSpace;
    identities: Map<number, GenieIdentity>;
    resumeConversationId: string | null;
  }): Promise<SpaceRead> {
    return this.spaceMessages({
      config,
      token,
      options,
      budget,
      space,
      // Not `cursor.sinceMs` directly: a source that prices its questions
      // reads further back than its watermark, because a question's compute
      // is published well after the question. The watermark itself is
      // untouched — `nextCursor` derives it from the cursor, not from this —
      // so this only ever widens what a run reads.
      // Read against the clock rather than the sweep's anchor: "far enough
      // back that the bill has landed" is a statement about now. A resumed
      // sweep carries an anchor that may be hours old, and deriving the floor
      // from it would widen the window for no benefit.
      sinceMs: this.warehouseCosts.costReadFloor({
        sinceMs: cursor.sinceMs,
        nowMs: nowInstant().epochMilliseconds,
        costEnabled: config.warehouseId !== undefined,
      }),
      identities,
      resumeConversationId,
    });
  }

  /**
   * Every new message across one space's conversations, resumable partway.
   *
   * The conversation list is walked in a DETERMINISTIC order this method
   * imposes itself — sorted by `conversation_id` — rather than in whatever
   * order the workspace happened to return it. That sort is what makes
   * `resumeConversationId` safe.
   *
   * Resuming means skipping every conversation before the resume point, and
   * that is only sound if a conversation cannot MOVE across it between runs.
   * Databricks documents no ordering guarantee for this endpoint, so without a
   * sort of our own a conversation that existed when the sweep began could sit
   * after the resume point on one run and before it on the next, get skipped
   * for the rest of the sweep, and then be filtered out for good once the
   * completed sweep advanced the watermark past its messages. Sorting on an
   * immutable key removes the dependency on the API's ordering entirely.
   *
   * A conversation CREATED while the sweep is in flight may still sort before
   * the resume point and be skipped — and that is fine, because every message
   * in it is necessarily newer than `sweepStartedAtMs`, which is where the
   * watermark lands. The next sweep picks it up.
   */
  private async spaceMessages({
    config,
    token,
    options,
    budget,
    space,
    sinceMs,
    identities,
    resumeConversationId,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    space: GenieSpace;
    sinceMs: number;
    identities: Map<number, GenieIdentity>;
    resumeConversationId: string | null;
  }): Promise<SpaceRead> {
    const conversations = await this.listConversations({
      config,
      token,
      options,
      budget,
      space,
    });
    if (!conversations)
      // The whole space is unreadable. The sweep carries on to the others, so
      // this is a gap by definition.
      return {
        items: [],
        complete: false,
        resumeConversationId: null,
        hadGap: true,
        // Nothing was read, so nothing here is waiting to settle. `hadGap`
        // already holds the watermark for this space on its own.
        oldestPendingMs: null,
      };

    const conversationPlan = conversationWalkPlan({
      conversations,
      resumeConversationId,
    });
    const walked = await this.conversations.walkConversations({
      config,
      token,
      options,
      budget,
      space,
      sinceMs,
      identities,
      conversationPlan,
    });

    // A truncated LISTING keeps the space incomplete even when everything the
    // walk actually saw was read in full — there are pages of conversations it
    // never got to.
    return {
      ...walked,
      complete: walked.complete && conversations.complete,
    };
  }

  /**
   * Every conversation in one space, or null when the space could not be read.
   *
   * Isolated: a space the credential cannot see must not cost the workspace
   * the others, so the caller turns a null into `complete: false` rather than
   * letting the failure unwind the whole sweep.
   */
  private async listConversations({
    config,
    token,
    options,
    budget,
    space,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    space: GenieSpace;
  }): Promise<PagedRead<z.infer<typeof conversationSchema>> | null> {
    const listed = await this.workspace.isolate({
      what: "conversations",
      context: { spaceId: space.space_id },
      run: () =>
        this.workspace.paginate({
          config,
          token,
          options,
          budget,
          path: `/api/2.0/genie/spaces/${encodeURIComponent(space.space_id)}/conversations`,
          // Without this the endpoint answers with the CALLER'S OWN
          // conversations only, and a governance sweep would quietly report one
          // service account's activity as the workspace's.
          query: { include_all: "true" },
          parse: (body) => {
            const page = conversationsPageSchema.parse(body);
            return { items: page.conversations, next: page.next_page_token };
          },
        }),
    });
    return listed.ok ? listed.value : null;
  }

  /** The configured spaces, or every space the credential can see. */
  private async resolveSpaces({
    config,
    token,
    options,
    budget,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
  }): Promise<PagedRead<GenieSpace>> {
    if (config.spaceIds.length > 0) {
      // A pinned list still gets titles where they can be had. The title is
      // what a human reads on the governance screen — "ACME Revenue Analyst"
      // rather than `01f190cfd5c1…` — and a source that pinned its spaces
      // should not be the one that reads worse.
      //
      // Best-effort, and deliberately so: a credential permitted to read a
      // space's conversations but not to enumerate the workspace is a real
      // configuration, and it must keep working. A failed lookup costs the
      // label, never the records, so it neither fails the run nor marks the
      // sweep incomplete.
      const discovered = await this.workspace.isolate({
        what: "space titles",
        context: {},
        run: () => this.discoverSpaces({ config, token, options, budget }),
      });
      const titles = new Map(
        (discovered.ok ? discovered.value.items : []).map((s) => [s.space_id, s.title]),
      );
      return {
        items: config.spaceIds.map((space_id) => ({
          space_id,
          title: titles.get(space_id) ?? null,
        })),
        complete: true,
      };
    }

    return this.discoverSpaces({ config, token, options, budget });
  }

  /** Every Genie space the credential can enumerate. */
  private async discoverSpaces({
    config,
    token,
    options,
    budget,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
  }): Promise<PagedRead<GenieSpace>> {
    // Through `walkGenieSpaces` rather than the local `paginate`, so the
    // on-demand agent listing and this sweep enumerate spaces the same way:
    // one endpoint, one schema, one cycle check. What stays here is the
    // stopping rule, which is the only part the two callers disagree on.
    const walk = await walkGenieSpaces({
      readPage: (query) =>
        this.workspace.get({
          config,
          token,
          options,
          budget,
          path: GENIE_SPACES_PATH,
          query,
        }),
      stop: () => budget.exhausted(),
      pageSize: PAGE_SIZE,
    });
    return { items: walk.spaces, complete: walk.complete };
  }
}
