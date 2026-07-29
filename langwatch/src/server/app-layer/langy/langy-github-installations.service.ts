/**
 * Langy ↔ GitHub App installations: the install/webhook lifecycle and the
 * per-turn installation-token mint that Langy hands the worker. There is no
 * per-user OAuth and no stored secret — an installation IS the access boundary,
 * and tokens are minted on demand from the App private key (held only in the
 * control plane) and never persisted. Issue #4747.
 *
 * Routes → this service → repository / app-token service. Business rules
 * (which installation, which repository scope) live here, never in the route.
 */
import { createLogger } from "@langwatch/observability";

import {
  computeRepoScopeKey,
  GithubInstallationNotFoundError,
  type GithubRepository,
  type LangyGithubAppTokenService,
} from "./langyGithubAppToken";
import type {
  LangyGithubInstallationRow,
  LangyGithubInstallationsRepository,
  LangyGithubRepositoryRef,
} from "./repositories/langy-github-installations.repository";

const logger = createLogger("langwatch:langy:github-installations");

/** The token + acting identity a turn hands to the worker for a bot-authored PR. */
export interface LangyGithubTurnToken {
  token: string;
  /** Stable key for the token's repository/permission scope — folded into the
   * worker credential signature so a scope change re-warms the worker. */
  repoScopeKey: string;
  installationId: string;
}

/** A recognised installation webhook action. */
export type LangyGithubWebhookAction =
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
export class LangyGithubInstallationConflictError extends Error {
  public readonly installationId: string;
  public readonly existingOrganizationId: string;
  public readonly attemptedOrganizationId: string;

  constructor({
    installationId,
    existingOrganizationId,
    attemptedOrganizationId,
  }: {
    installationId: string;
    existingOrganizationId: string;
    attemptedOrganizationId: string;
  }) {
    super(
      `GitHub installation ${installationId} is already connected to a different organization`,
    );
    this.name = "LangyGithubInstallationConflictError";
    this.installationId = installationId;
    this.existingOrganizationId = existingOrganizationId;
    this.attemptedOrganizationId = attemptedOrganizationId;
  }
}

export class LangyGithubInstallationsService {
  constructor(
    private readonly repo: LangyGithubInstallationsRepository,
    private readonly appTokens: LangyGithubAppTokenService,
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
    return this.repo.isOrganizationMember(params);
  }

  getAllForOrganization(
    organizationId: string,
  ): Promise<LangyGithubInstallationRow[]> {
    return this.repo.findAllForOrganization(organizationId);
  }

  getByInstallationId(
    installationId: string,
  ): Promise<LangyGithubInstallationRow | null> {
    return this.repo.findByInstallationId(installationId);
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

    let repositories: LangyGithubRepositoryRef[] | null = null;
    if (details.repositorySelection === "selected") {
      // Best-effort: cache the selected repo list so settings can show it
      // without a live call. A failure here must not fail the install.
      try {
        repositories =
          await this.appTokens.listInstallationRepositories(installationId);
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
        throw new LangyGithubInstallationConflictError({
          installationId: details.installationId,
          existingOrganizationId: row.organizationId,
          attemptedOrganizationId: organizationId,
        });
      }
      // Genuine re-install under the SAME org: refresh the cached account +
      // repo fields (the initial insert attempt above never landed).
      await this.repo.upsert(input);
    }

    return { accountLogin: details.accountLogin };
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
    action: LangyGithubWebhookAction;
    installationId: string;
    repositorySelection?: string;
    repositories?: LangyGithubRepositoryRef[] | null;
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
        const existing = await this.repo.findByInstallationId(installationId);
        if (!existing) return;
        // Re-fetch the authoritative selection rather than trust the event's
        // partial repo list.
        try {
          const details = await this.appTokens.getInstallation(installationId);
          let repositories: LangyGithubRepositoryRef[] | null = null;
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
   */
  async listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<GithubRepository[]> {
    const installations =
      await this.repo.findAllForOrganization(organizationId);
    const seen = new Set<string>();
    const out: GithubRepository[] = [];
    for (const inst of installations) {
      if (inst.suspendedAt) continue;
      try {
        const repos = await this.appTokens.listInstallationRepositories(
          inst.installationId,
        );
        for (const r of repos) {
          if (seen.has(r.fullName)) continue;
          seen.add(r.fullName);
          out.push(r);
        }
      } catch (error) {
        logger.warn(
          { error, installationId: inst.installationId },
          "failed to list repositories for installation",
        );
      }
    }
    return out;
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
   * `LangyGithubInstallation` row for an installation GitHub has already
   * forgotten. Rather than let that dead row block every real installation
   * behind it forever, a confirmed 404 from GitHub — whether it surfaces
   * while minting or while resolving an explicit repo id — removes the row
   * and moves on to the next candidate.
   *
   * TODO(JIT narrowing): the plan's delivery option 2 replaces spawn-env
   * with a clone-time credential-helper callback that mints per-clone; the
   * seam is `repoScopeKey`, already threaded into the worker signature.
   */
  async mintTurnToken({
    organizationId,
    repositoryFullName,
  }: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<LangyGithubTurnToken | null> {
    if (!this.configured) return null;
    const installations =
      await this.repo.findAllForOrganization(organizationId);
    const usable = installations.filter((i) => !i.suspendedAt);
    if (usable.length === 0) return null;

    // Explicit repo: pick the installation that can reach it and scope to it.
    // A candidate that turns out to be a dead installation — whether that
    // surfaces while resolving the repo id (an uncached "all" selection has to
    // list live) or while minting — is self-healed away in favor of the next
    // one that can reach the same repo, rather than failing the turn outright.
    if (repositoryFullName) {
      for (const inst of usable) {
        let repoId: string | null;
        try {
          repoId = await this.resolveRepositoryId(inst, repositoryFullName);
        } catch (error) {
          if (!(error instanceof GithubInstallationNotFoundError)) throw error;
          await this.markInstallationDead(inst.installationId);
          continue;
        }
        if (!repoId) continue;
        const outcome = await this.mintScoped({
          installationId: inst.installationId,
          repositoryIds: [repoId],
        });
        if (outcome.token) return outcome.token;
        if (!outcome.wasDeadInstallation) return null;
      }
      // The App is not installed on that repo — bounded by the installation.
      return null;
    }

    // No explicit repo: mint against the org's installation(s) scoped to the
    // full repo set, oldest first. An installation GitHub confirms is gone
    // (404) is removed and the next candidate is tried instead of failing the
    // whole turn; any other mint failure stops here, same as before — a
    // transient error must not make us skip past a live installation.
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
    token: LangyGithubTurnToken | null;
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

  // Removes a `LangyGithubInstallation` row GitHub has confirmed (404) it no
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
    inst: LangyGithubInstallationRow,
    repositoryFullName: string,
  ): Promise<string | null> {
    const wanted = repositoryFullName.toLowerCase();
    const fromCache = inst.repositories?.find(
      (r) => r.fullName.toLowerCase() === wanted,
    );
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
