/**
 * The organization's GitHub connection: the install/webhook lifecycle, and the
 * token mints its consumers ask for. There is no per-user OAuth and no stored
 * secret, an installation IS the access boundary, and tokens are minted on
 * demand from the App private key (held only in the control plane) and never
 * persisted.
 *
 * Routes and procedures go through this service, never the repository. Business
 * rules (which installation, which repository scope) live here.
 *
 * Spec: specs/integrations/github-connection.feature.
 */
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import { GithubInstallationConflictError } from "@langwatch/github-contract";

import {
  GithubApiRateLimitedError,
  GithubInstallationSuspendedError,
} from "./github-errors.service";
import {
  computeRepoScopeKey,
  type GithubAppTokenService,
  GithubInstallationNotFoundError,
  GithubRateLimitedError,
  type GithubRepository,
} from "../adapters/github.github-app-token.adapter";
import type {
  GithubInstallationRow,
  GithubInstallationsRepository,
  GithubRepositoryRef,
} from "../repositories/github-installations.repository";

const logger = createLogger("langwatch:github:installations");

/** The token + acting identity a turn hands to the worker for a bot-authored PR. */
export interface GithubTurnToken {
  token: string;
  /** Stable key for the token's repository/permission scope — folded into the
   * worker credential signature so a scope change re-warms the worker. */
  repoScopeKey: string;
  installationId: string;
}

/** A recognised installation webhook action. */
export type GithubWebhookAction =
  | "created"
  | "deleted"
  | "suspend"
  | "unsuspend"
  | "added"
  | "removed";

/**
 * Thrown when a `/setup` callback tries to bind an installation that another
 * organization already owns — the cross-tenant installation-takeover guard.
 *
 * The `installation_id` at `/setup` is an attacker-controllable query param that
 * is NOT part of the signed state, and `getInstallation` authenticates as the
 * App (so it returns metadata for ANY installation of this App, on ANY account).
 * Without this guard, a caller holding a valid signed state for their OWN org
 * could point `/setup` at a victim org's installation id and have the upsert
 * rebind that unique-`installationId` row to their org — silently stealing
 * 1h `contents:write`/`pull_requests:write` tokens on the victim's private
 * repos. The route maps this to the generic install-failed message so a blocked
 * attacker learns nothing about whether the id exists.
 */
export class GithubInstallationsService {
  static create(
    repo: GithubInstallationsRepository,
    appTokens: GithubAppTokenService,
    organization: OrganizationService,
    onInstallationRecorded?: (params: {
      installationId: string;
      organizationId: string;
    }) => void | Promise<void>,
  ): GithubInstallationsService {
    return new GithubInstallationsService(
      repo,
      appTokens,
      organization,
      onInstallationRecorded,
    );
  }

  private constructor(
    private readonly repo: GithubInstallationsRepository,
    private readonly appTokens: GithubAppTokenService,
    private readonly organization: OrganizationService,
    /**
     * Called after a fresh installation is recorded, so a consumer can warm
     * whatever it derives from the connection (pull-request mapping backfills
     * its repositories this way). Fire-and-forget: the installation is already
     * committed and the customer is watching a redirect, so a slow or failing
     * consumer must not hold up, or fail, the install.
     */
    private readonly onInstallationRecorded?: (params: {
      installationId: string;
      organizationId: string;
    }) => void | Promise<void>,
  ) {}

  /** True when the App private key + id are configured on this instance. */
  get configured(): boolean {
    return this.appTokens.configured;
  }

  /** Gates the install-start + webhook-attributed operations. */
  isOrganizationMember(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.organization.isMember(params);
  }

  getAllForOrganization(organizationId: string): Promise<GithubInstallationRow[]> {
    return this.repo.findAllForOrganization(organizationId);
  }

  /**
   * One stored installation row, by its GitHub id.
   *
   * Not gated on `configured`, unlike the mint and resolve paths. Those need
   * the App private key to do anything, so an unconfigured instance answering
   * from stored rows alone would promise access it cannot deliver. This read
   * reaches no credential: its callers use the row to attribute a webhook to an
   * organization and to check that an installation belongs to the organization
   * asking about it, and both answers are correct whether or not the key is
   * set. Gating it would drop pull-request announcements the payload alone can
   * be written from, and would hide the uninstall link for a row that exists.
   */
  tryGetByInstallationId(installationId: string): Promise<GithubInstallationRow | null> {
    return this.repo.tryFindByInstallationId(installationId);
  }

  /**
   * Complete an install: fetch the installation's account + repo selection from
   * GitHub (verifying the installation id is real and reachable by the App) and
   * record it against the organization the signed state bound. Returns the
   * connected account login for the completion screen.
   */
  async recordInstallation({
    installationId,
    organizationId,
  }: {
    installationId: string;
    organizationId: string;
  }): Promise<{ accountLogin: string }> {
    const details = await this.appTokens.getInstallation(installationId);

    let repositories: GithubRepositoryRef[] | null = null;
    if (details.repositorySelection === "selected") {
      // Best-effort: cache the selected repo list so settings can show it
      // without a live call. A failure here must not fail the install.
      try {
        repositories = await this.appTokens.listInstallationRepositories(installationId);
      } catch (error) {
        logger.warn(
          { error, installationId },
          "failed to fetch selected repositories at install time",
        );
      }
    }

    const input = {
      installationId: details.installationId,
      organizationId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      accountId: details.accountId,
      repositorySelection: details.repositorySelection,
      repositories,
    };

    // Cross-tenant takeover guard, made race-safe: `insertOrGetExisting`
    // claims the installation atomically via the DB's unique index rather
    // than this code checking-then-writing across two awaits, so two
    // concurrent `/setup` calls racing for the same fresh installation id can
    // never both observe "unclaimed". Whichever loses the race always sees
    // the winner's committed org here.
    const { wasInserted, row } = await this.repo.insertOrGetExisting(input);
    if (!wasInserted) {
      if (row.organizationId !== organizationId) {
        throw new GithubInstallationConflictError({
          installationId: details.installationId,
          existingOrganizationId: row.organizationId,
          attemptedOrganizationId: organizationId,
        });
      }
      // Genuine re-install under the SAME org: refresh the cached account +
      // repo fields (the initial insert attempt above never landed).
      await this.repo.upsert(input);
    }

    this.notifyInstallationRecorded({
      installationId: details.installationId,
      organizationId,
    });

    return { accountLogin: details.accountLogin };
  }

  private notifyInstallationRecorded(params: {
    installationId: string;
    organizationId: string;
  }): void {
    if (!this.onInstallationRecorded) return;
    try {
      void Promise.resolve(this.onInstallationRecorded(params)).catch(
        (error: unknown) => {
          logger.warn({ error, ...params }, "installation-recorded hook failed");
        },
      );
    } catch (error) {
      logger.warn({ error, ...params }, "installation-recorded hook failed");
    }
  }

  /**
   * Apply an installation webhook. Idempotent: created/added re-sync the row,
   * deleted removes it, suspend/unsuspend flip the flag. The caller has already
   * verified the HMAC signature. `organizationId` is only needed for `created`
   * (a fresh installation not yet mapped) — GitHub's setup callback normally
   * records it first, so a webhook for an unknown installation with no org is a
   * no-op rather than an error.
   */
  async handleWebhookEvent(params: {
    action: GithubWebhookAction;
    installationId: string;
    repositorySelection?: string;
    repositories?: GithubRepositoryRef[] | null;
  }): Promise<void> {
    const { action, installationId } = params;
    switch (action) {
      case "deleted":
        await this.repo.deleteByInstallationId(installationId);
        return;
      case "suspend":
        await this.repo.setSuspended({ installationId, suspended: true });
        return;
      case "unsuspend":
        await this.repo.setSuspended({ installationId, suspended: false });
        return;
      case "created":
      case "added":
      case "removed": {
        // Repository-set changes (and a re-created installation already mapped)
        // refresh the cached selection. An unknown installation with no local
        // row is left alone — the setup callback owns first-time org mapping.
        const existing = await this.repo.tryFindByInstallationId(installationId);
        if (!existing) return;
        // Re-fetch the authoritative selection rather than trust the event's
        // partial repo list.
        try {
          const details = await this.appTokens.getInstallation(installationId);
          let repositories: GithubRepositoryRef[] | null = null;
          if (details.repositorySelection === "selected") {
            repositories =
              await this.appTokens.listInstallationRepositories(installationId);
          }
          await this.repo.setRepositories({
            installationId,
            repositorySelection: details.repositorySelection,
            repositories,
          });
        } catch (error) {
          logger.warn(
            { error, installationId, action },
            "failed to refresh installation repositories from webhook",
          );
        }
        return;
      }
    }
  }

  /**
   * List every repository reachable across the organization's installations.
   * Aggregated + de-duplicated by full name. Used by the settings UI.
   *
   * Two failures are named rather than swallowed, because an empty list is a
   * lie the reader can act on wrongly: an organization whose every
   * installation is suspended, and GitHub refusing on a rate limit (which the
   * next installation would hit too). A per-installation failure of any other
   * kind is still logged and skipped.
   */
  async listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<GithubRepository[]> {
    const installations = await this.repo.findAllForOrganization(organizationId);
    const usable = installations.filter((i) => !i.suspendedAt);
    if (installations.length > 0 && usable.length === 0) {
      throw new GithubInstallationSuspendedError({
        accountLogin: installations[0]!.accountLogin,
      });
    }
    const seen = new Set<string>();
    const out: GithubRepository[] = [];
    for (const inst of usable) {
      const repos = await this.listRepositoriesForInstallation(inst.installationId);
      for (const repo of repos) {
        if (seen.has(repo.fullName)) continue;
        seen.add(repo.fullName);
        out.push(repo);
      }
    }
    return out;
  }

  /**
   * One installation's repositories, or none at all.
   *
   * A rate limit is rethrown, because the next installation would hit it too
   * and a short list would read as a complete one. Any other failure leaves
   * this installation out and lets the rest still answer.
   */
  private async listRepositoriesForInstallation(
    installationId: string,
  ): Promise<GithubRepository[]> {
    try {
      return await this.appTokens.listInstallationRepositories(installationId);
    } catch (error) {
      if (error instanceof GithubRateLimitedError) {
        throw new GithubApiRateLimitedError(
          { retryAfterSec: error.retryAfterSec },
          { reasons: [error] },
        );
      }
      logger.warn(
        { error, installationId },
        "failed to list repositories for installation",
      );
      return [];
    }
  }

  /**
   * The installation that can reach `repositoryFullName`, and that repository's
   * numeric id on GitHub: the pair every read-only pull-request call needs.
   * Null when GitHub is unconfigured, the organization has no usable
   * installation, or none of them covers the repository.
   *
   * Shares `resolveRepositoryIdOrHeal` with the mint path, so it resolves the
   * same way: the cached selection first, a live listing for an "all"
   * installation, and a confirmed-dead installation healed away rather than
   * blocking the live one behind it.
   */
  async tryResolveInstallationForRepository({
    organizationId,
    repositoryFullName,
  }: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<{ installationId: string; repositoryId: string } | null> {
    if (!this.configured) return null;
    const installations = await this.repo.findAllForOrganization(organizationId);
    for (const inst of installations.filter((i) => !i.suspendedAt)) {
      const resolved = await this.resolveRepositoryIdOrHeal(inst, repositoryFullName);
      if (resolved.repoId) {
        return {
          installationId: inst.installationId,
          repositoryId: resolved.repoId,
        };
      }
    }
    return null;
  }

  /**
   * Whether the organization's connection covers `repositoryFullName`, decided
   * from what is already stored: an "all" installation covers every repository
   * on its own account, a "selected" one covers exactly its cached list. No
   * GitHub call, so a page listing many repositories costs nothing.
   *
   * Deliberately optimistic for "all": the account login is matched against the
   * repository's owner, which is what the customer sees on GitHub, and a
   * repository they cannot actually reach still fails honestly at the mapping
   * call. Deliberately pessimistic for "selected" with no cached list, which
   * means the install-time fetch failed and we genuinely do not know.
   *
   * False on an instance with no App configured, for the same reason
   * `tryResolveInstallationForRepository` returns null there: stored rows can
   * outlive the credentials that made them usable, and every lookup they would
   * authorise short-circuits before it reaches GitHub. Answering "covered" off
   * those rows alone tells a reader the connection reaches a repository that
   * nothing on this instance can read.
   */
  async coversRepository({
    organizationId,
    repositoryFullName,
  }: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean> {
    if (!this.configured) return false;
    const wanted = repositoryFullName.toLowerCase();
    const owner = wanted.split("/")[0] ?? "";
    const installations = await this.repo.findAllForOrganization(organizationId);
    return installations
      .filter((i) => !i.suspendedAt)
      .some((inst) =>
        inst.repositorySelection === "all"
          ? inst.accountLogin.toLowerCase() === owner
          : (inst.repositories ?? []).some((r) => r.fullName.toLowerCase() === wanted),
      );
  }

  /**
   * Mint the per-turn installation token Langy hands the worker.
   *
   * Repo resolution (agent-infers, control
   * plane validates): when the turn carries an explicit `repositoryFullName`,
   * find the installation that can reach it and scope the token to ONLY that
   * repo. Otherwise scope to the installation's full repository set (still
   * installation-bounded, 1h — strictly better than the old 8h user token).
   *
   * Returns null when GitHub is unconfigured, the org has no (usable)
   * installation, or the mint fails — the caller degrades to the connect card.
   *
   * Self-heals stale installations: a webhook delivery can be missed (or an
   * installation can predate the webhook being configured at all), leaving a
   * `GithubInstallation` row for an installation GitHub has already
   * forgotten. Rather than let that dead row block every real installation
   * behind it forever, a confirmed 404 from GitHub — whether it surfaces
   * while minting or while resolving an explicit repo id — removes the row
   * and moves on to the next candidate.
   *
   * TODO(JIT narrowing): the plan's delivery option 2 replaces spawn-env
   * with a clone-time credential-helper callback that mints per-clone; the
   * seam is `repoScopeKey`, already threaded into the worker signature.
   */
  async tryMintTurnToken({
    organizationId,
    repositoryFullName,
  }: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    if (!this.configured) return null;
    const installations = await this.repo.findAllForOrganization(organizationId);
    const usable = installations.filter((i) => !i.suspendedAt);
    if (usable.length === 0) return null;

    return repositoryFullName
      ? this.mintForExplicitRepo(usable, repositoryFullName)
      : this.mintForAnyInstallation(usable);
  }

  // Pick the installation that can reach `repositoryFullName` and scope the
  // token to only that repo. A candidate that turns out to be a dead
  // installation — whether that surfaces while resolving the repo id (an
  // uncached "all" selection has to list live) or while minting — is
  // self-healed away in favor of the next one that can reach the same repo,
  // rather than failing the turn outright.
  private async mintForExplicitRepo(
    usable: GithubInstallationRow[],
    repositoryFullName: string,
  ): Promise<GithubTurnToken | null> {
    for (const inst of usable) {
      const resolved = await this.resolveRepositoryIdOrHeal(inst, repositoryFullName);
      if (!resolved.repoId) continue;
      const outcome = await this.mintScoped({
        installationId: inst.installationId,
        repositoryIds: [resolved.repoId],
      });
      if (outcome.token) return outcome.token;
      if (!outcome.wasDeadInstallation) return null;
    }
    // The App is not installed on that repo — bounded by the installation.
    return null;
  }

  // resolveRepositoryId, with the self-heal-and-continue decision factored out
  // of the caller's control flow: a confirmed-dead installation is healed here
  // and reported back as "nothing to resolve" rather than thrown, so
  // mintForExplicitRepo stays a flat loop.
  private async resolveRepositoryIdOrHeal(
    inst: GithubInstallationRow,
    repositoryFullName: string,
  ): Promise<{ repoId: string | null; wasDeadInstallation: boolean }> {
    try {
      const repoId = await this.resolveRepositoryId(inst, repositoryFullName);
      return { repoId, wasDeadInstallation: false };
    } catch (error) {
      if (!(error instanceof GithubInstallationNotFoundError)) throw error;
      await this.markInstallationDead(inst.installationId);
      return { repoId: null, wasDeadInstallation: true };
    }
  }

  // Mint against the org's installation(s) scoped to the full repo set,
  // oldest first. An installation GitHub confirms is gone (404) is removed
  // and the next candidate is tried instead of failing the whole turn; any
  // other mint failure stops here — a transient error must not make us skip
  // past a live installation.
  private async mintForAnyInstallation(
    usable: GithubInstallationRow[],
  ): Promise<GithubTurnToken | null> {
    for (const inst of usable) {
      const outcome = await this.mintScoped({
        installationId: inst.installationId,
      });
      if (outcome.token) return outcome.token;
      if (!outcome.wasDeadInstallation) return null;
    }
    return null;
  }

  private async mintScoped({
    installationId,
    repositoryIds,
  }: {
    installationId: string;
    repositoryIds?: string[];
  }): Promise<{
    token: GithubTurnToken | null;
    wasDeadInstallation: boolean;
  }> {
    try {
      const minted = await this.appTokens.mintInstallationToken({
        installationId,
        ...(repositoryIds ? { repositoryIds } : {}),
      });
      return {
        token: {
          token: minted.token,
          repoScopeKey: computeRepoScopeKey({ repositoryIds }),
          installationId,
        },
        wasDeadInstallation: false,
      };
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) {
        await this.markInstallationDead(installationId);
        return { token: null, wasDeadInstallation: true };
      }
      logger.warn(
        { error, installationId },
        "failed to mint installation token for turn",
      );
      return { token: null, wasDeadInstallation: false };
    }
  }

  // Removes a `GithubInstallation` row GitHub has confirmed (404) it no
  // longer knows about. Shared by every call site that can hit that error —
  // minting and, via listInstallationRepositories, resolving a repo id too.
  private async markInstallationDead(installationId: string): Promise<void> {
    logger.warn(
      { installationId },
      "github installation no longer exists, removing stale record",
    );
    await this.repo.deleteByInstallationId(installationId);
  }

  // Resolve a repo full-name to its numeric id for a given installation, from
  // the cached selection when present, else a live listing. A confirmed-dead
  // installation (GithubInstallationNotFoundError) is rethrown so the caller
  // can self-heal it — every other failure degrades to "can't resolve", same
  // as before.
  private async resolveRepositoryId(
    inst: GithubInstallationRow,
    repositoryFullName: string,
  ): Promise<string | null> {
    const wanted = repositoryFullName.toLowerCase();
    const fromCache = inst.repositories?.find((r) => r.fullName.toLowerCase() === wanted);
    if (fromCache) return fromCache.id;
    // "all" selection has no cached list — resolve live.
    try {
      const repos = await this.appTokens.listInstallationRepositories(
        inst.installationId,
      );
      const match = repos.find((r) => r.fullName.toLowerCase() === wanted);
      return match?.id ?? null;
    } catch (error) {
      if (error instanceof GithubInstallationNotFoundError) throw error;
      logger.warn(
        { error, installationId: inst.installationId, repositoryFullName },
        "failed to resolve repository id for installation",
      );
      return null;
    }
  }
}
