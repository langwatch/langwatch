// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** One Databricks workspace's REST surface for a Genie run: sign-in, budgeted reads and the SCIM directory. */

import { Buffer } from "node:buffer";

import {
  DATABRICKS_GENIE_ADAPTER_ID,
  ProviderSignInError,
} from "@langwatch/enterprise-governance-contract";
import type {
  DatabricksGeniePullConfig,
  PullRunOptions,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { GovernanceHttpClient } from "../channels/governance-http.channel.ts";
import {
  type GenieIdentity,
  UNKNOWN_IDENTITY,
  genieIdentityFromScimUser,
  scimUserSchema,
} from "../rules/databricks-genie-message-event.rules.ts";
import type { PagedRead } from "../rules/databricks-genie-sweep.rules.ts";
import { WAREHOUSE_COST_TIMEOUT_MS } from "../rules/databricks-genie-warehouse-cost.rules.ts";
import type { DatabricksGenieRunBudgetService } from "./databricks-genie-run-budget.service.ts";

const logger = createLogger("langwatch:governance:databricks-genie-puller");

const REQUEST_TIMEOUT_MS = 30_000;
export const PAGE_SIZE = 100;

/**
 * A sign-in is one small POST. The job has five minutes for everything, so a
 * token endpoint that never answers must not be allowed to spend it: without a
 * bound of its own the run would hit the per-job deadline having read nothing
 * and report a timeout that names no cause.
 */
const TOKEN_TIMEOUT_MS = 15_000;

/**
 * What a Databricks OAuth token endpoint returns. Only `access_token` is
 * load-bearing — `expires_in` is not kept, because a token is minted per run
 * and never outlives it.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

/**
 * A non-2xx from the workspace, carrying the status.
 *
 * The status is on the error rather than only in its message because one
 * caller has to branch on it: a 404 from SCIM is a permanent answer worth
 * caching, and every other code is a transient one that must not be.
 */
export class GenieHttpError extends Error {
  readonly status: number;

  constructor({ status, statusText, path }: { status: number; statusText: string; path: string }) {
    super(`HTTP ${status} ${statusText} (databricks genie ${path})`);
    this.name = "GenieHttpError";
    this.status = status;
  }
}

export class DatabricksGenieWorkspaceService {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create(http: GovernanceHttpClient): DatabricksGenieWorkspaceService {
    return new DatabricksGenieWorkspaceService(http);
  }

  /**
   * The bearer to present on this run's Genie calls.
   *
   * A pasted workspace token expires about an hour after Databricks issues it,
   * so a source configured that way works when the admin saves it and is dead by
   * the next scheduled run, with nothing on the source to say why. A service
   * principal's client id and secret do not expire, so the source signs in at
   * the start of every run and the schedule keeps running unattended.
   *
   * A pasted token wins when both are present. Someone pasting one into a source
   * that already had a secret is rotating by hand — usually because the secret
   * stopped working — and silently preferring the secret would ignore the thing
   * they just did.
   *
   * Minted once per run rather than per request: the sweep walks several pages
   * across several spaces, and a token per request would multiply one sign-in by
   * the whole walk for no benefit, since the token outlives any single run.
   */
  async resolveWorkspaceToken(params: {
    credentials: Record<string, string> | undefined;
    workspaceUrl: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const { credentials, workspaceUrl, signal } = params;

    const pasted = credentials?.token;
    if (pasted) return pasted;

    const clientId = credentials?.clientId;
    const clientSecret = credentials?.clientSecret;
    if (!clientId || !clientSecret) {
      throw new ProviderSignInError(
        "databricks genie puller needs either a workspace token in credentials.token, " +
          "or a service principal's credentials.clientId and credentials.clientSecret",
        { reason: "not_configured" },
      );
    }

    // HTTP Basic rather than the secret in the body: the header is not written
    // to the request line, so it stays out of proxy and access logs.
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const timeout = AbortSignal.timeout(TOKEN_TIMEOUT_MS);

    const response = await this.http.fetch(`${workspaceUrl.replace(/\/+$/, "")}/oidc/v1/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=all-apis",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      // This request carries the client secret itself. Never hand it to a
      // redirect target.
      followRedirects: false,
    });

    if (!response.ok) {
      // The status alone, never the body: a token endpoint may echo the request
      // back, and this reason is logged and shown on the source.
      throw new ProviderSignInError(
        `databricks genie puller could not sign in: the workspace refused the ` +
          `service principal's credentials (HTTP ${response.status})`,
        { reason: "refused", status: response.status },
      );
    }

    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      // A proxy or captive portal answering 200 with something that is not a
      // token must not be carried forward as one — it would fail later as an
      // unauthorised Genie call and read as a permissions problem.
      throw new ProviderSignInError(
        "databricks genie puller could not sign in: the workspace answered the " +
          "sign-in without an access token",
        { reason: "malformed_response" },
      );
    }

    return parsed.data.access_token;
  }

  /** One authenticated POST, budgeted and abortable. */
  async post({
    config,
    token,
    options,
    budget,
    path,
    body,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    path: string;
    body: unknown;
  }): Promise<unknown> {
    const url = new URL(path, config.workspaceUrl);

    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(WAREHOUSE_COST_TIMEOUT_MS)])
      : AbortSignal.timeout(WAREHOUSE_COST_TIMEOUT_MS);

    budget.spend();
    const response = await this.http.fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new GenieHttpError({
        status: response.status,
        statusText: response.statusText,
        path,
      });
    }
    return response.json();
  }

  async get({
    config,
    token,
    options,
    budget,
    path,
    query,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    path: string;
    query?: Record<string, string>;
  }): Promise<unknown> {
    const url = new URL(path, config.workspaceUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

    budget.spend();
    const response = await this.http.fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new GenieHttpError({
        status: response.status,
        statusText: response.statusText,
        path,
      });
    }
    return response.json();
  }

  /**
   * Walks one paginated Databricks list endpoint to the end, or to the budget.
   *
   * `complete: false` says pages were left unread. It is NOT an error and the
   * items already read are returned — the caller's job is to make sure the
   * watermark does not step over what is missing.
   *
   * A `next_page_token` that has already been seen in this walk is refused
   * rather than followed. Databricks pages by opaque token, so a token that
   * revisits a page is a contract violation, and following it would spend the
   * run's whole request budget re-reading the same pages and then report "out
   * of budget" — indistinguishable, from the outside, from a workspace that is
   * merely large. Same shape as `has_more` with no token, same answer.
   *
   * The whole set is tracked, not just the previous token: A → B → A is a
   * cycle too, and a check against only the last one walks it forever.
   */
  async paginate<T>({
    config,
    token,
    options,
    budget,
    path,
    query,
    parse,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    path: string;
    query?: Record<string, string>;
    parse: (body: unknown) => { items: T[]; next: string | null };
  }): Promise<PagedRead<T>> {
    const items: T[] = [];
    let page: string | null = null;
    const seen = new Set<string>();

    while (!budget.exhausted()) {
      const parsed = parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path,
          query: {
            ...query,
            page_size: String(PAGE_SIZE),
            ...(page ? { page_token: page } : {}),
          },
        }),
      );
      items.push(...parsed.items);

      if (parsed.next === null) return { items, complete: true };
      if (seen.has(parsed.next)) {
        throw new Error(
          `databricks genie ${path} returned a page_token it had already served; refusing to re-read pages in a cycle`,
        );
      }
      seen.add(parsed.next);
      page = parsed.next;
    }

    return { items, complete: false };
  }

  /**
   * Runs one unit of the walk, answering `{ ok: false }` instead of throwing.
   *
   * This is where "keep what we read" is actually implemented. The caller turns
   * a failure into `complete: false`, which holds the watermark, so a failure
   * costs freshness rather than data.
   */
  async isolate<T>({
    what,
    context,
    run,
  }: {
    what: string;
    context: Record<string, string>;
    run: () => Promise<T>;
  }): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      logger.error(
        {
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          ...context,
          error: error instanceof Error ? error.message : String(error),
        },
        `databricks genie could not read ${what}; keeping the rest of the sweep and holding the watermark`,
      );
      return { ok: false };
    }
  }

  /**
   * The person behind a numeric author id, cached for the run.
   *
   * Only a 404 is remembered. A missing user is a permanent answer — the
   * account is gone, and asking again once per message would turn one deleted
   * user into hundreds of wasted calls. Anything else (a 429, a 503, a socket
   * reset) is transient, and caching THAT would take one unlucky moment and
   * silently strip the author off every remaining message in the run.
   *
   * Either way the event still lands. An unattributed question is worth
   * recording, and a directory hiccup must not cost the workspace its
   * visibility.
   */
  async identityFor({
    config,
    token,
    options,
    budget,
    userId,
    identities,
  }: {
    config: DatabricksGeniePullConfig;
    token: string;
    options: PullRunOptions;
    budget: DatabricksGenieRunBudgetService;
    userId: number | null;
    identities: Map<number, GenieIdentity>;
  }): Promise<GenieIdentity> {
    if (userId === null) return UNKNOWN_IDENTITY;
    const cached = identities.get(userId);
    if (cached) return cached;

    try {
      const user = scimUserSchema.parse(
        await this.get({
          config,
          token,
          options,
          budget,
          path: `/api/2.0/preview/scim/v2/Users/${encodeURIComponent(String(userId))}`,
        }),
      );
      const identity = genieIdentityFromScimUser(user, userId);
      identities.set(userId, identity);
      return identity;
    } catch (error) {
      const gone = error instanceof GenieHttpError && error.status === 404;
      logger.warn(
        {
          adapter: DATABRICKS_GENIE_ADAPTER_ID,
          userId,
          permanent: gone,
          error: error instanceof Error ? error.message : String(error),
        },
        "could not resolve a genie author through SCIM; recording the message unattributed",
      );
      // Only the permanent answer is remembered. A transient failure is left
      // uncached so the next message gets a fresh attempt.
      if (gone) identities.set(userId, UNKNOWN_IDENTITY);
      return UNKNOWN_IDENTITY;
    }
  }
}
