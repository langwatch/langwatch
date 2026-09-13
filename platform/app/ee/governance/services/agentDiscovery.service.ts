// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The feed that discovers agents.
 *
 * The two sources that know what agents exist already fetch the list. The Genie
 * sweep enumerates spaces to know what to walk; the Copilot walk reads the
 * `bot` table to put a name on a conversation. Both then threw the list away —
 * `DiscoveredAgent` has existed in the schema with no writer at all, so the
 * agents screen had nobody to show, exactly as the People screen did before
 * `PersonDiscoveryService`.
 *
 * This is the mirror of that service, with one difference that runs all the way
 * through: people are discovered from EVENTS the pull already collected, and
 * agents are discovered by ASKING the provider. Asking has a third answer.
 * "The provider listed none" and "the provider would not say" look identical
 * once a list is empty, and only one of them means the tenant has no agents. So
 * the listing carries {@link AgentListing} rather than an array, and this
 * service records rows only on the arms that actually name a tenant's agents.
 *
 * A refusal writes NOTHING. It is not evidence that an agent stopped existing,
 * and there is no write here that would improve on the rows already stored.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";

import { DiscoveredAgentRepository } from "../repositories/governanceIdentity.repository";
import {
  type AgentListingSourceType,
  sourceTypeCanListAgents,
} from "./logic/agentListingProviders";
import {
  type AgentListing,
  type AgentListingRefusal,
  agentsRefused,
  refusalFromThrown,
} from "./pullers/agentListing";
import { listCopilotAgents } from "./pullers/copilotBots";
import {
  type CopilotStudioDataverseConfig,
  copilotStudioDataversePullConfigSchema,
  resolveEnvironmentToken,
} from "./pullers/copilotStudioDataverse.puller";
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  type DatabricksGeniePullConfig,
  databricksGeniePullConfigSchema,
  resolveWorkspaceToken,
} from "./pullers/databricksGenie.puller";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "./pullers/dataverseEnvironment";
import { listGenieAgents } from "./pullers/genieSpaces";
import { ProviderSignInError } from "./pullers/pullerAdapter";
import {
  type SourceCredentialContext,
  withSourceCredentials,
} from "./pullers/sourceCredentialAccess";

const logger = createLogger("langwatch:governance:agent-discovery");

/** What one sync did, in the three shapes the listing itself comes in. */
export type AgentSyncResult =
  | { outcome: "listed"; recorded: number }
  | { outcome: "empty" }
  | { outcome: "refused"; refusal: AgentListingRefusal };

/** What every provider's lister is handed. */
type AgentListerParams = {
  context: SourceCredentialContext;
  signal?: AbortSignal;
};

/**
 * Re-exported so existing callers keep one import, but OWNED by the leaf.
 *
 * The question "can this source type list agents" is answered from the same
 * list the dispatch table below is keyed by, and that list lives in a module
 * with no prisma and no adapters so the pure logic can ask it without dragging
 * this service in.
 */
export { sourceTypeCanListAgents };

/**
 * A sign-in failure as a listing refusal.
 *
 * `refused` carries the sign-in endpoint's own status so a wrong secret reads
 * as unauthorized rather than as a network problem. The message never travels:
 * a sign-in reply can echo the request back, secret included.
 */
function refusalFromSignIn(error: ProviderSignInError): AgentListingRefusal {
  if (error.reason === "not_configured") {
    return { reason: "not_configured", status: null };
  }
  if (error.reason === "malformed_response") {
    return { reason: "malformed_response", status: null };
  }
  const status = error.status;
  if (status === 401 || status === 403 || status === null) {
    return { reason: "unauthorized", status };
  }
  return { reason: "unavailable", status };
}

export class AgentDiscoveryService {
  private readonly prisma: PrismaClient;
  private readonly agents: DiscoveredAgentRepository;

  constructor({ prisma }: { prisma: PrismaClient }) {
    this.prisma = prisma;
    this.agents = new DiscoveredAgentRepository();
  }

  static create(prisma: PrismaClient): AgentDiscoveryService {
    return new AgentDiscoveryService({ prisma });
  }

  /**
   * Asks one source's provider what agents it has, and writes down what it
   * said.
   *
   * `now` is a parameter rather than a clock read, so a caller syncing several
   * sources stamps them all with one instant and a test can assert on the
   * dates it passed in.
   */
  async syncFromSource(params: {
    organizationId: string;
    ingestionSourceId: string;
    now: Date;
    signal?: AbortSignal;
  }): Promise<AgentSyncResult> {
    const { organizationId, ingestionSourceId, now, signal } = params;

    // The provider comes back WITH the listing rather than being read from the
    // source a second time: it is the source type the seam already resolved,
    // and a second read is a second chance for the two to disagree.
    const { provider, listing } = await withSourceCredentials({
      prisma: this.prisma,
      organizationId,
      ingestionSourceId,
      use: async (context) => ({
        provider: context.sourceType,
        listing: await listAgentsForSource({ context, signal }),
      }),
    });

    if (listing.outcome === "refused") {
      // Logged rather than thrown: the caller gets the refusal as a value and
      // decides what to show. The reason and the status are safe to log; the
      // provider's reply body never reached this point.
      logger.warn(
        {
          organizationId,
          ingestionSourceId,
          reason: listing.refusal.reason,
          status: listing.refusal.status,
        },
        "provider would not list its agents; leaving the recorded agents as they are",
      );
      return { outcome: "refused", refusal: listing.refusal };
    }
    if (listing.outcome === "empty") return { outcome: "empty" };

    for (const agent of listing.items) {
      await this.agents.recordAgentSighting(this.prisma, {
        organizationId,
        // The source type, which is what `DiscoveredAgent.provider` holds —
        // the same value `DiscoveredPerson.provider` carries, so the two
        // tables can be read side by side for one provider.
        provider,
        rawAgentId: agent.rawAgentId,
        displayText: agent.displayText,
        metadata: agent.metadata,
        seenAt: now,
      });
    }
    return { outcome: "listed", recorded: listing.items.length };
  }
}

/**
 * The config parse sits OUTSIDE the `try` in each lister below, and has to
 * stay there.
 *
 * These used to parse inside one wide `try`. The catch was written for exactly
 * that parse -- a config that no longer matches its schema really is a source
 * that is not set up to be asked -- and then two network calls were added
 * inside the same block and silently inherited its verdict. Every DNS failure,
 * TLS failure, timeout and blocked egress during sign-in was recorded as an
 * unconfigured source, and the page told an administrator to go audit a
 * permission that was never at fault.
 *
 * The comment on that catch described one case and the code covered all of
 * them. Scoping each `try` to the network calls alone is what stops that
 * recurring: a third provider or a fourth await inherits the safe default
 * instead of the config verdict, without anyone remembering to.
 */
async function listGenieAgentsForSource({
  context,
  signal,
}: AgentListerParams): Promise<AgentListing> {
  const parsed = databricksGeniePullConfigSchema.safeParse(context.config);
  if (!parsed.success) {
    return agentsRefused({ reason: "not_configured", status: null });
  }
  const config: DatabricksGeniePullConfig = parsed.data;

  try {
    const token = await resolveWorkspaceToken({
      credentials: context.credentials,
      workspaceUrl: config.workspaceUrl,
      signal,
    });
    return await listGenieAgents({
      workspaceUrl: config.workspaceUrl,
      token,
      signal,
    });
  } catch (error) {
    return agentsRefusedFromThrow(error);
  }
}

/** Same shape as the Genie lister above, including where the `try` starts. */
async function listCopilotAgentsForSource({
  context,
  signal,
}: AgentListerParams): Promise<AgentListing> {
  const parsed = copilotStudioDataversePullConfigSchema.safeParse(
    context.config,
  );
  if (!parsed.success) {
    return agentsRefused({ reason: "not_configured", status: null });
  }
  const config: CopilotStudioDataverseConfig = parsed.data;

  try {
    const token = await resolveEnvironmentToken({
      credentials: context.credentials,
      environmentUrl: config.environmentUrl,
      signal,
    });
    return await listCopilotAgents({
      environmentUrl: config.environmentUrl,
      token,
      signal,
    });
  } catch (error) {
    return agentsRefusedFromThrow(error);
  }
}

/**
 * Every provider that can list agents, and the one function that does it.
 *
 * ONE LIST, because this used to be two. A set named the providers for
 * `sourceTypeCanListAgents` and a chain of `if` blocks dispatched them, and
 * both encoded the same fact. Adding a third provider to the set alone made
 * every ask return `not_configured` from a screen that had just offered the
 * button; adding it to the chain alone meant the screen never offered it.
 * Neither mistake breaks a build and both are silent.
 *
 * Keyed by `AgentListingSourceType`, so the ids and the listers cannot drift:
 * a provider added to the leaf's list and not given a lister here fails to
 * compile, which is the only moment anybody is in a position to write one.
 */
const LISTER_BY_SOURCE_TYPE: Record<
  AgentListingSourceType,
  (params: AgentListerParams) => Promise<AgentListing>
> = {
  [DATABRICKS_GENIE_ADAPTER_ID]: listGenieAgentsForSource,
  [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID]: listCopilotAgentsForSource,
};

/**
 * The same table as a `Map`, which is what the dispatch actually reads.
 *
 * `sourceType` arrives from a database column, and indexing an object literal
 * with an untrusted string reaches its prototype — `constructor` would come
 * back a function and be dispatched as a lister. `Map.get` answers undefined
 * for every key it was not given. The Record above is kept for the
 * exhaustiveness the compiler can only check on an object type, so this gets
 * both: the type says the table is complete, the Map says the lookup is safe.
 */
const AGENT_LISTERS: ReadonlyMap<
  string,
  (params: AgentListerParams) => Promise<AgentListing>
> = new Map(Object.entries(LISTER_BY_SOURCE_TYPE));

/** Dispatches to the provider that owns this source type. */
async function listAgentsForSource(
  params: AgentListerParams,
): Promise<AgentListing> {
  const lister = AGENT_LISTERS.get(params.context.sourceType);
  // Not an error, deliberately: a screen offering this for one source in a
  // list must be able to say "this one cannot" without the request failing.
  if (!lister) return agentsRefused({ reason: "not_configured", status: null });
  return lister(params);
}

/**
 * A throw from a provider turned into a refusal, without guessing.
 *
 * A deliberate sign-in verdict is kept as-is, so a genuinely missing or
 * rejected credential still reads as a credential problem. Anything else
 * reaching here came out of the transport, and the only question worth asking
 * is whether the body was the wrong shape or the request never arrived --
 * which is what {@link refusalFromThrown} decides, on a constructor-set
 * `name` rather than on message text.
 *
 * The default it lands on is `unreachable`, and that direction is the point.
 * Telling someone to try again when their credential was wrong costs them one
 * wasted retry. Telling someone to audit a permission when a network was down
 * sends them to change access control over a fault that was never theirs.
 */
function agentsRefusedFromThrow(error: unknown): AgentListing {
  if (error instanceof ProviderSignInError) {
    return agentsRefused(refusalFromSignIn(error));
  }
  return agentsRefused(refusalFromThrown(error));
}
