import type { SlackConnectionClaimant, SlackConnectionClaimPage } from "@langwatch/slack-contract";
import { z } from "zod";

import type {
  SlackConnectionClaimKey,
  SlackConnectionClaimRepository,
} from "../repositories/slack-connection-claim.repository.ts";
import type { SlackConnectionService } from "./slack-connection.service.ts";

/**
 * Who holds a connection in use (ARCHITECTURE.md §3, the claims ruling):
 * automation claims one when it saves a trigger on it and releases it when the
 * trigger moves off, pauses or is deleted. A claimed connection is never deleted.
 */
export class SlackConnectionClaimService {
  private constructor(
    private readonly deps: Readonly<{
      claims: SlackConnectionClaimRepository;
      connections: Pick<SlackConnectionService, "getUsableRow">;
    }>,
  ) {}

  static create(deps: {
    claims: SlackConnectionClaimRepository;
    connections: Pick<SlackConnectionService, "getUsableRow">;
  }): SlackConnectionClaimService {
    return new SlackConnectionClaimService(deps);
  }

  /** Idempotent; a connection the claimant's project cannot use is `slack_integration_missing`. */
  async claimConnection({
    connectionId,
    projectId,
    claimant,
  }: {
    connectionId: string;
    projectId: string;
    claimant: SlackConnectionClaimant;
  }): Promise<void> {
    const { connection } = await this.deps.connections.getUsableRow({
      id: connectionId,
      projectId,
    });
    await this.deps.claims.upsert({
      connectionId: connection.id,
      claimantId: claimant.id,
      claimantLabel: claimant.label,
      organizationId: connection.organizationId,
      projectId,
    });
  }

  /** Idempotent: releasing nothing is fine. */
  async releaseConnection(input: {
    connectionId: string;
    projectId: string;
    claimantId: string;
  }): Promise<void> {
    await this.deps.claims.delete(input);
  }

  /** One page of every claim by claim id; a cursor no page handed out fails. */
  async listSlackConnectionClaims({
    after,
    limit = CLAIM_PAGE_LIMIT,
  }: {
    after?: string;
    limit?: number;
  }): Promise<SlackConnectionClaimPage> {
    const size = Math.min(Math.max(Math.trunc(limit), 1), CLAIM_PAGE_LIMIT);
    const rows = await this.deps.claims.findPage({
      after: after === undefined ? undefined : claimKeyOf(after),
      limit: size,
    });
    const last = rows.at(-1);
    return {
      claims: rows.map((row) => ({
        connectionId: row.connectionId,
        projectId: row.projectId,
        claimant: { id: row.claimantId, label: row.claimantLabel },
      })),
      next: last && rows.length === size ? cursorOf(last) : null,
    };
  }
}

/** The most claims one page reads. */
const CLAIM_PAGE_LIMIT = 500;

const claimCursorSchema = z.tuple([z.string().min(1), z.string().min(1)]);

function cursorOf({ connectionId, claimantId }: SlackConnectionClaimKey): string {
  return JSON.stringify([connectionId, claimantId]);
}

/** A cursor only a page hands out; anything else is a caller's bug, so a plain error. */
function claimKeyOf(cursor: string): SlackConnectionClaimKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    parsed = undefined;
  }
  const key = claimCursorSchema.safeParse(parsed);
  if (!key.success) throw new Error("The claim page cursor was not handed out by a page.");
  const [connectionId, claimantId] = key.data;
  return { connectionId, claimantId };
}
