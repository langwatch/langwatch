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
  constructor(
    public readonly installationId: string,
    public readonly existingOrganizationId: string,
    public readonly attemptedOrganizationId: string,
  ) {
    super(
      `GitHub installation ${installationId} is already connected to a different organization`,
    );
    this.name = "LangyGithubInstallationConflictError";
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

    // Cross-tenant takeover guard: never let a `/setup` call rebind an
    // installation another org already owns. `installationId` is unique, so an
    // upsert would otherwise overwrite the existing row's `organizationId`. A
    // genuine re-install of the same account under the SAME org still upserts
    // cleanly (same org → no conflict). See LangyGithubInstallationConflictError.
    const existing = await this.repo.findByInstallationId(
      details.installationId,
    );
    if (existing && existing.organizationId !== organizationId) {
      throw new LangyGithubInstallationConflictError(
        details.installationId,
        existing.organizationId,
        organizationId,
      );
    }

    let repositories: LangyGithubRepositoryRef[] | null = null;
    if (details.repositorySelection === "selected") {
      // Best-effort: cache the selected repo list so settings can show it
      // without a live call. A failure here must not fail the install.
      try {
        repositories = await this.appTokens.listInstallationRepositories(
          installationId,
        );
      } catch (error) {
        logger.warn(
          { error, installationId },
          "failed to fetch selected repositories at install time",
        );
      }
    }
    await this.repo.upsert({
      installationId: details.installationId,
      organizationId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      accountId: details.accountId,
      repositorySelection: details.repositorySelection,
      repositories,
    });
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
            repositories = await this.appTokens.listInstallationRepositories(
              installationId,
            );
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
    const installations = await this.repo.findAllForOrganization(
      organizationId,
    );
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
   * Repo resolution (LANGY_GITHUB_AUTH_PLAN.md §7.2 — agent-infers, control
   * plane validates): when the turn carries an explicit `repositoryFullName`,
   * find the installation that can reach it and scope the token to ONLY that
   * repo. Otherwise scope to the installation's full repository set (still
   * installation-bounded, 1h — strictly better than the old 8h user token).
   *
   * Returns null when GitHub is unconfigured, the org has no (usable)
   * installation, or the mint fails — the caller degrades to the connect card.
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
    const installations = await this.repo.findAllForOrganization(
      organizationId,
    );
    const usable = installations.filter((i) => !i.suspendedAt);
    if (usable.length === 0) return null;

    // Explicit repo: pick the installation that can reach it and scope to it.
    if (repositoryFullName) {
      for (const inst of usable) {
        const repoId = await this.resolveRepositoryId(inst, repositoryFullName);
        if (repoId) {
          return this.mintScoped({
            installationId: inst.installationId,
            repositoryIds: [repoId],
          });
        }
      }
      // The App is not installed on that repo — bounded by the installation.
      return null;
    }

    // No explicit repo: mint against the org's installation scoped to its full
    // repo set. When an org has multiple installations we take the first usable
    // one (a repo chip disambiguates in the explicit path above).
    const inst = usable[0]!;
    return this.mintScoped({ installationId: inst.installationId });
  }

  private async mintScoped({
    installationId,
    repositoryIds,
  }: {
    installationId: string;
    repositoryIds?: string[];
  }): Promise<LangyGithubTurnToken | null> {
    try {
      const minted = await this.appTokens.mintInstallationToken({
        installationId,
        ...(repositoryIds ? { repositoryIds } : {}),
      });
      return {
        token: minted.token,
        repoScopeKey: computeRepoScopeKey({ repositoryIds }),
        installationId,
      };
    } catch (error) {
      logger.warn(
        { error, installationId },
        "failed to mint installation token for turn",
      );
      return null;
    }
  }

  // Resolve a repo full-name to its numeric id for a given installation, from
  // the cached selection when present, else a live listing.
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
      logger.warn(
        { error, installationId: inst.installationId, repositoryFullName },
        "failed to resolve repository id for installation",
      );
      return null;
    }
  }
}
