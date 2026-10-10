import { createLogger } from "@langwatch/observability";
import { SlackConnectionExistsError } from "@langwatch/slack-contract";

import type {
  SlackConnectionRepository,
  SlackConnectionRow,
  SlackScope,
} from "../repositories/slack-connection.repository.ts";
import { reachableScopes, type SecretIdentity } from "../rules/slack-connection.rules.ts";

const logger = createLogger("langwatch:slack:connections");

type SlackSecretHolderDeps = Readonly<{ connections: SlackConnectionRepository }>;

/** Which connections already hold a secret, under the current or a retired fingerprint key. */
export class SlackSecretHolderService {
  private constructor(private readonly deps: SlackSecretHolderDeps) {}

  static create(deps: SlackSecretHolderDeps): SlackSecretHolderService {
    return new SlackSecretHolderService(deps);
  }

  /** The project's own connection holding the secret first, then its organization's. */
  async findReachableHolders({
    organizationId,
    projectId,
    identity,
  }: {
    organizationId: string;
    projectId: string;
    identity: SecretIdentity;
  }): Promise<SlackConnectionRow[]> {
    const holders = await this.findHolders({
      organizationId,
      identity,
      scopes: reachableScopes({ organizationId, projectId }),
    });
    return [
      ...holders.filter((holder) => holder.scopeType === "PROJECT"),
      ...holders.filter((holder) => holder.scopeType !== "PROJECT"),
    ];
  }

  /**
   * The connections holding a secret in `scopes`, under the current key or a
   * retired one. A row found under a retired key is restamped under the current
   * one, so the previous key can later be removed.
   */
  private async findHolders({
    organizationId,
    identity,
    scopes,
  }: {
    organizationId: string;
    identity: SecretIdentity;
    scopes: SlackScope[];
  }): Promise<SlackConnectionRow[]> {
    const [current, ...retired] = await Promise.all(
      [identity.current, ...identity.retired].map((secretFingerprint) =>
        this.deps.connections.findAllByFingerprint({ organizationId, secretFingerprint, scopes }),
      ),
    );
    const stale = retired.flat();
    await Promise.all(
      stale.map((row) => this.restamp({ row, secretFingerprint: identity.current })),
    );
    return [...(current ?? []), ...stale];
  }

  /** Best effort: a row left under a retired key is restamped by the next lookup that finds it. */
  private async restamp({
    row,
    secretFingerprint,
  }: {
    row: SlackConnectionRow;
    secretFingerprint: string;
  }): Promise<void> {
    try {
      await this.deps.connections.replaceFingerprint({
        id: row.id,
        organizationId: row.organizationId,
        secretFingerprint,
      });
    } catch (error) {
      logger.warn(
        { error, connectionId: row.id },
        "a Slack connection found under the previous fingerprint key could not be moved to the current one; the next lookup tries again",
      );
    }
  }

  /**
   * Refuses a write whose secret its target scope already holds. A project
   * write also counts its organization's connections, which the project can
   * already use; another project's copy never counts, nor is it named.
   */
  async assertSecretFree({
    organizationId,
    target,
    identity,
    exceptId,
  }: {
    organizationId: string;
    target: SlackScope;
    identity: SecretIdentity;
    exceptId?: string;
  }): Promise<void> {
    const holders = await this.findHolders({
      organizationId,
      identity,
      scopes:
        target.scopeType === "ORGANIZATION"
          ? [target]
          : reachableScopes({ organizationId, projectId: target.scopeId }),
    });
    const holder = holders.find((each) => each.id !== exceptId);
    if (holder) {
      throw new SlackConnectionExistsError({
        connectionId: holder.id,
        connectionName: holder.name,
      });
    }
  }
}
