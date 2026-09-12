// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Asking a provider who works here.
 *
 * People discovery already exists and already works, and this does not replace
 * it: `PersonDiscoveryService` writes down everyone a pulled event NAMES, and
 * has since the People screen had nobody to show. What it cannot do is find
 * somebody who has not shown up in a row yet. A person who holds a seat and
 * has not touched a model this month is invisible to it, and for Microsoft the
 * one read that does list staff only runs when Copilot Studio Dataverse is
 * connected and only once a day.
 *
 * So this is the same feature as the agent listing, pointed at people: ASK the
 * provider, which has a third answer. "Listed nobody" and "would not say" look
 * identical once a list is empty, and only one of them means the tenant has no
 * staff. Hence {@link PeopleListing} rather than an array.
 *
 * What it deliberately does NOT do is write `DiscoveredPerson`. It builds the
 * directory events a pull would have built and hands them to the existing
 * service, behind the existing erasure check, in that order. The pullers
 * re-read a lookback window, which is why that check exists at all: any writer
 * that skipped it would re-create a plaintext person row the day after every
 * erasure (ADR-128 §9 step 1). A staff list is exactly that kind of re-read,
 * on demand, so it passes the same check keyed on the same field, with no
 * listing-specific carve-out to keep in step.
 *
 * A refusal writes NOTHING. It is not evidence anybody left.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  OPENAI_ADMIN_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";

import {
  loadErasureSuppression,
  partitionSuppressedEvents,
} from "./erasureSuppression.service";
import { PersonDiscoveryService } from "./personDiscovery.service";
import { listAnthropicPeople, listOpenAiPeople } from "../../../../../modules/governance/server/src/services/adminApiUsers.ts";
import {
  type CopilotStudioDataverseConfig,
  copilotStudioDataversePullConfigSchema,
} from "../../../../../modules/governance/server/src/services/copilot-studio-dataverse-puller.service.ts";
import { resolveEnvironmentToken } from "./pullers/copilotStudioDataverse.puller";
import {
  DATABRICKS_GENIE_ADAPTER_ID,
  type DatabricksGeniePullConfig,
  databricksGeniePullConfigSchema,
  resolveWorkspaceToken,
} from "../../../../../../specs/ai-governance/puller-framework/databricks-genie.feature";
import { listDatabricksPeople } from "../../../../../modules/governance/server/src/services/databricksScimUsers.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../../../../modules/governance/server/src/services/dataverse-environment.service.ts";
import { listMicrosoftPeople } from "../../../../../modules/governance/server/src/services/microsoftDirectoryRead.ts";
import { MICROSOFT_GRAPH_SCOPE } from "../../../../../modules/governance/server/src/services/microsoftGraphSeats.ts";
import {
  listingDay,
  type PeopleListing,
  type PeopleListingRefusal,
  peopleRefused,
  personListingEvents,
} from "../../../../../modules/governance/server/src/services/peopleListing.ts";
import { refusalFromThrown } from "../../../../../modules/governance/server/src/services/providerListing.ts";
import { ProviderSignInError } from "./pullers/pullerAdapter";
import {
  type SourceCredentialContext,
  withSourceCredentials,
} from "../../../../../modules/governance/server/src/services/sourceCredentialAccess.ts";

const logger = createLogger("langwatch:governance:person-listing");

/**
 * What one sync did, in the three shapes the listing itself comes in.
 *
 * The listed arm reports both sides of the erasure check rather than only what
 * survived it. `recorded` alone cannot answer "did the provider name anyone",
 * because a tenant that erased its whole staff drives it to zero while the
 * provider named hundreds, and a caller that stores only that number can never
 * recover the difference.
 *
 * `named` is everyone the provider's directory named. `withheld` is how many of
 * those this deployment does not hold, because erasure suppression removed
 * them: a SUBSET of `named`, never an addition to it. Adding the two counts the
 * same people twice. Subtracting is the valid arithmetic, and `recorded` is
 * exactly that subtraction, carried here only because this is the layer that
 * did the writing and knows it first hand.
 *
 * `withheld` is safe to show as a CURRENT figure and never as a series: it
 * moving from zero to one at a known moment says an erasure happened then,
 * which on a small tenant identifies the person as surely as a name would.
 */
export type PeopleSyncResult =
  | { outcome: "listed"; recorded: number; named: number; withheld: number }
  | { outcome: "empty" }
  | { outcome: "refused"; refusal: PeopleListingRefusal };

/**
 * The source types that can list people.
 *
 * Every other source type is a refusal rather than an error, and deliberately:
 * a screen that offers this for one source in a list must be able to say "this
 * one cannot" without the request failing.
 */
const PEOPLE_LISTING_SOURCE_TYPES: ReadonlySet<string> = new Set([
  ANTHROPIC_ADMIN_ADAPTER_ID,
  OPENAI_ADMIN_ADAPTER_ID,
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  DATABRICKS_GENIE_ADAPTER_ID,
]);

export function sourceTypeCanListPeople(sourceType: string): boolean {
  return PEOPLE_LISTING_SOURCE_TYPES.has(sourceType);
}

/**
 * A sign-in failure as a listing refusal.
 *
 * `refused` carries the sign-in endpoint's own status so a wrong secret reads
 * as unauthorized rather than as a network problem. The message never travels:
 * a sign-in reply can echo the request back, secret included.
 */
function refusalFromSignIn(error: ProviderSignInError): PeopleListingRefusal {
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

export class PersonListingService {
  private readonly prisma: PrismaClient;
  private readonly discovery: PersonDiscoveryService;

  constructor({ prisma }: { prisma: PrismaClient }) {
    this.prisma = prisma;
    this.discovery = PersonDiscoveryService.create(prisma);
  }

  static create(prisma: PrismaClient): PersonListingService {
    return new PersonListingService({ prisma });
  }

  /**
   * Asks one source's provider who works there, and writes down what it said.
   *
   * `now` is a parameter rather than a clock read, so a caller syncing several
   * sources stamps them all with one instant and a test can assert on the day
   * it passed in.
   */
  async syncFromSource(params: {
    organizationId: string;
    ingestionSourceId: string;
    now: Date;
    signal?: AbortSignal;
  }): Promise<PeopleSyncResult> {
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
        listing: await listPeopleForSource({ context, signal }),
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
        "provider would not list its people; leaving the recorded people as they are",
      );
      return { outcome: "refused", refusal: listing.refusal };
    }
    if (listing.outcome === "empty") return { outcome: "empty" };

    const events = personListingEvents({
      people: listing.items,
      provider,
      day: listingDay(now),
    });

    // The do-not-reimport list, checked BEFORE anything is written, exactly
    // where the pull checks it and against the same `actor` field.
    const suppression = await loadErasureSuppression({
      prisma: this.prisma,
      organizationId,
      provider,
    });
    const { kept, suppressedCount } = partitionSuppressedEvents({
      events,
      actorOf: (event) => event.actor,
      suppression,
    });
    if (suppressedCount > 0) {
      // Worth a line: these are real people the provider named that this sync
      // deliberately did not store, so a total that looks short has an
      // explanation here rather than looking like a listing that lost rows.
      logger.info(
        { organizationId, ingestionSourceId, suppressedCount },
        "skipped listed people naming an erased identifier",
      );
    }

    const { discovered } = await this.discovery.recordFromPulledEvents({
      organizationId,
      // The source type, which is what `DiscoveredPerson.provider` holds.
      provider,
      events: kept,
    });

    // A `recorded` of zero is possible here and is not the same as `empty`: it
    // means the provider named people and every one of them is erased. The
    // tenant has staff; this deployment is right not to hold their names, and
    // `named` is what keeps that distinguishable from an empty directory.
    //
    // `named` counts the events built from the listing rather than
    // `listing.items`, so the two numbers add up: `personListingEvents` drops
    // records with a blank actor, and one of those is a person no erasure check
    // could have suppressed. Counting it as named would leave a shortfall that
    // reads as withheld.
    return {
      outcome: "listed",
      recorded: discovered,
      named: events.length,
      withheld: suppressedCount,
    };
  }
}

/**
 * The entry point the sync uses to ask one source for its people.
 *
 * A single wide `try` used to sit here and gave every throw the verdict
 * "not configured", which was written for a config that no longer parses. A
 * network drop inside a sign-in inherited that verdict, so an unreachable
 * provider told an administrator to go re-enter a working secret. Each branch
 * below now parses its config first and scopes its own `try` to the network
 * calls alone, so a third provider or a fourth await inherits the safe default
 * instead of the config verdict, without anyone remembering to.
 */
async function listPeopleForSource(params: {
  context: SourceCredentialContext;
  signal?: AbortSignal;
}): Promise<PeopleListing> {
  return await listPeopleFromProvider(params);
}

/**
 * A throw from a provider turned into a refusal, without guessing.
 *
 * A deliberate sign-in verdict is kept as-is, so a genuinely missing or
 * rejected credential still reads as a credential problem. Anything else
 * reaching here came out of the transport, and {@link refusalFromThrown}
 * decides on a constructor-set `name` rather than on message text.
 *
 * The default it lands on is `unreachable`, and that direction is the point.
 * Telling someone to try again when their credential was wrong costs them one
 * wasted retry. Telling someone their source holds no credential when a network
 * was down sends them to re-enter a secret that was never at fault.
 */
function peopleRefusedFromThrow(error: unknown): PeopleListing {
  if (error instanceof ProviderSignInError) {
    return peopleRefused(refusalFromSignIn(error));
  }
  return peopleRefused(refusalFromThrown(error));
}

/**
 * Dispatches to the provider that owns this source type.
 *
 * Every branch returns a refusal rather than throwing, so one bad source in a
 * list never fails the whole sync. An unparseable config is decided before any
 * request goes out, which is what keeps "not configured" meaning that and only
 * that.
 */
async function listPeopleFromProvider(
  params: ProviderListingRequest,
): Promise<PeopleListing> {
  const { context } = params;

  if (context.sourceType === ANTHROPIC_ADMIN_ADAPTER_ID) {
    return await listFromAnthropic(params);
  }
  if (context.sourceType === OPENAI_ADMIN_ADAPTER_ID) {
    return await listFromOpenAi(params);
  }
  if (context.sourceType === COPILOT_STUDIO_DATAVERSE_ADAPTER_ID) {
    return await listFromCopilotStudio(params);
  }
  if (context.sourceType === DATABRICKS_GENIE_ADAPTER_ID) {
    return await listFromDatabricksGenie(params);
  }

  return peopleRefused(NOT_CONFIGURED);
}

/**
 * What one provider branch needs, named once.
 *
 * The four branches below take this type rather than each restating the shape.
 * A hand-written copy per branch is a second description of a value that has
 * only one, and the two drift apart silently: an optional field on the copy
 * that the caller always supplies is never exercised as optional by a test.
 */
type ProviderListingRequest = {
  context: SourceCredentialContext;
  signal?: AbortSignal;
};

// Neither admin API has a sign-in step: the admin key IS the credential, and
// neither needs a field from the source's config, so neither config is parsed.
// A source with an odd config that still holds a working key can still answer.
async function listFromAnthropic({
  context,
  signal,
}: ProviderListingRequest): Promise<PeopleListing> {
  const apiKey = context.credentials.token;
  if (!apiKey) return peopleRefused(NOT_CONFIGURED);
  try {
    return await listAnthropicPeople({ apiKey, signal });
  } catch (error) {
    return peopleRefusedFromThrow(error);
  }
}

async function listFromOpenAi({
  context,
  signal,
}: ProviderListingRequest): Promise<PeopleListing> {
  const apiKey = context.credentials.token;
  if (!apiKey) return peopleRefused(NOT_CONFIGURED);
  try {
    return await listOpenAiPeople({ apiKey, signal });
  } catch (error) {
    return peopleRefusedFromThrow(error);
  }
}

async function listFromCopilotStudio({
  context,
  signal,
}: ProviderListingRequest): Promise<PeopleListing> {
  const parsed = copilotStudioDataversePullConfigSchema.safeParse(
    context.config,
  );
  if (!parsed.success) return peopleRefused(NOT_CONFIGURED);
  const config: CopilotStudioDataverseConfig = parsed.data;

  try {
    const token = await resolveEnvironmentToken({
      credentials: context.credentials,
      environmentUrl: config.environmentUrl,
      // The directory lives on Graph, not on the environment. A token minted
      // for Dataverse is refused by Graph, so this is a second sign-in rather
      // than a reuse of the one the transcript read makes.
      scope: MICROSOFT_GRAPH_SCOPE,
      signal,
    });
    return await listMicrosoftPeople({ token, signal });
  } catch (error) {
    return peopleRefusedFromThrow(error);
  }
}

async function listFromDatabricksGenie({
  context,
  signal,
}: ProviderListingRequest): Promise<PeopleListing> {
  const parsed = databricksGeniePullConfigSchema.safeParse(context.config);
  if (!parsed.success) return peopleRefused(NOT_CONFIGURED);
  const config: DatabricksGeniePullConfig = parsed.data;

  try {
    const token = await resolveWorkspaceToken({
      credentials: context.credentials,
      workspaceUrl: config.workspaceUrl,
      signal,
    });
    return await listDatabricksPeople({
      workspaceUrl: config.workspaceUrl,
      token,
      signal,
    });
  } catch (error) {
    return peopleRefusedFromThrow(error);
  }
}

const NOT_CONFIGURED: PeopleListingRefusal = {
  reason: "not_configured",
  status: null,
};
