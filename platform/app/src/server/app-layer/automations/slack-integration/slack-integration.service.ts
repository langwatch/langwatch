import { createLogger } from "@langwatch/observability";
import { decrypt, encrypt } from "~/utils/encryption";
import {
  fetchSlackWorkspaceIdentity,
  isSlackTransportFailure,
  type SlackWorkspaceIdentity,
} from "../delivery/slackWebApi";
import {
  SlackIntegrationInvalidTokenError,
  SlackIntegrationMissingError,
} from "../errors";
import type {
  LegacySlackTokenAutomation,
  SlackIntegrationRepository,
} from "./repositories/slack-integration.repository";

const logger = createLogger("langwatch:automations:slack-integration");

/**
 * What a client is allowed to know about the project's Slack connection:
 * whether there is one, and which workspace it reaches. The token itself has no
 * representation here — it is decrypted at dispatch and channel discovery and
 * nowhere else.
 */
export interface SlackIntegrationStatus {
  connected: boolean;
  slackTeamId: string | null;
  slackTeamName: string | null;
  connectedAt: Date | null;
  updatedAt: Date | null;
}

const DISCONNECTED: SlackIntegrationStatus = {
  connected: false,
  slackTeamId: null,
  slackTeamName: null,
  connectedAt: null,
  updatedAt: null,
};

/** Outcome of switching several automations off their own tokens at once. */
export interface LegacyTokenClearResult {
  cleared: number;
  /** Rows that already carried no token — nothing to do, not a failure. */
  alreadyClear: number;
  failed: number;
}

/**
 * The project's Slack integration (ADR-093 §5): set up once, rotated in one
 * place, and consumed by every Slack delivery in the project that does not
 * carry a token of its own.
 *
 * Setup and rotation are the same path — validate the token against Slack,
 * store the ciphertext, pin the workspace `auth.test` named — because a
 * rotation that skipped validation would swap a working connection for a broken
 * one and only say so at the next delivery.
 */
export class SlackIntegrationService {
  constructor(
    private readonly repo: SlackIntegrationRepository,
    private readonly verifyToken: (
      token: string,
    ) => Promise<
      | { ok: true; identity: SlackWorkspaceIdentity }
      | { ok: false; error: string }
    > = fetchSlackWorkspaceIdentity,
  ) {}

  async getStatus({
    projectId,
  }: {
    projectId: string;
  }): Promise<SlackIntegrationStatus> {
    const row = await this.repo.findByProject({ projectId });
    if (!row) return DISCONNECTED;
    return {
      connected: true,
      slackTeamId: row.slackTeamId,
      slackTeamName: row.slackTeamName,
      connectedAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Connect Slack for a project, or rotate the token of an existing
   * connection. Nothing is written unless Slack accepts the token, so a refused
   * setup leaves a project with no integration exactly as it found it, and a
   * refused rotation leaves the working one in place.
   */
  async setup({
    projectId,
    organizationId,
    botToken,
    userId,
  }: {
    projectId: string;
    organizationId: string;
    botToken: string;
    userId: string;
  }): Promise<SlackIntegrationStatus> {
    const token = botToken.trim();
    // A local slug, not "invalid_auth": `meta.slackError` carries Slack's own
    // code, and Slack never saw this request.
    if (!token) throw new SlackIntegrationInvalidTokenError("empty_token");

    const verified = await this.verifyToken(token);
    if (!verified.ok) {
      // A transport failure is infrastructure, not a token refusal — it stays
      // a plain Error and degrades to the generic unknown at the boundary.
      if (isSlackTransportFailure(verified.error)) {
        throw new Error(
          `Slack auth.test did not answer usably: ${verified.error}`,
        );
      }
      throw new SlackIntegrationInvalidTokenError(verified.error);
    }

    const row = await this.repo.upsertForProject({
      projectId,
      organizationId,
      botTokenEncrypted: encrypt(token),
      slackTeamId: verified.identity.teamId,
      slackTeamName: verified.identity.teamName,
      userId,
    });
    return {
      connected: true,
      slackTeamId: row.slackTeamId,
      slackTeamName: row.slackTeamName,
      connectedAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async remove({ projectId }: { projectId: string }): Promise<void> {
    await this.repo.deleteForProject({ projectId });
  }

  /**
   * The decrypted project token, for dispatch and channel discovery only. Null
   * when the project has no integration — the caller decides whether that is a
   * refusal or a fall-through.
   */
  async getBotToken({
    projectId,
  }: {
    projectId: string;
  }): Promise<string | null> {
    const row = await this.repo.findByProject({ projectId });
    if (!row) return null;
    return decrypt(row.botTokenEncrypted);
  }

  /** The automations still carrying their own token — the migration's census. */
  async getLegacyTokenAutomations({
    projectId,
  }: {
    projectId: string;
  }): Promise<LegacySlackTokenAutomation[]> {
    return this.repo.findAllWithOwnSlackToken({ projectId });
  }

  /**
   * Switch automations onto the project integration by clearing the token they
   * store. Refused outright while the project has no integration — clearing
   * then would leave the automations with nothing to deliver with. Each row is
   * independent: one that cannot be updated is counted as failed and keeps
   * delivering with its own token, one that already carries no token is
   * already where the switch was taking it, and the rest still move. Passing
   * no ids switches every automation in the project that has one.
   */
  async clearLegacyTokens({
    projectId,
    triggerIds,
  }: {
    projectId: string;
    triggerIds?: string[];
  }): Promise<LegacyTokenClearResult> {
    const integration = await this.repo.findByProject({ projectId });
    if (!integration) throw new SlackIntegrationMissingError();

    const targets =
      triggerIds ??
      (await this.repo.findAllWithOwnSlackToken({ projectId })).map(
        (row) => row.id,
      );

    let cleared = 0;
    let alreadyClear = 0;
    let failed = 0;
    for (const triggerId of targets) {
      try {
        const outcome = await this.repo.clearOwnSlackToken({
          projectId,
          triggerId,
        });
        if (outcome === "cleared") cleared++;
        else if (outcome === "already_clear") alreadyClear++;
        else failed++;
      } catch (error) {
        // The card reports "N switched, 1 failed" and tells the operator to
        // try again. Without the cause, nobody — including support — can say
        // why. The ids are opaque internal identifiers, logged raw on purpose.
        logger.error(
          { error, projectId, triggerId },
          "clearing a legacy Slack token failed",
        );
        failed++;
      }
    }
    return { cleared, alreadyClear, failed };
  }
}
