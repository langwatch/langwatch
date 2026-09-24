// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  copilotStudioDataversePullConfigSchema,
  OPENAI_ADMIN_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { AdminApiUsersChannel } from "../channels/admin-api-users.channel.ts";
import type { DatabricksScimUsersChannel } from "../channels/databricks-scim-users.channel.ts";
import type { MicrosoftDirectoryChannel } from "../channels/microsoft-directory.channel.ts";
import type { ProviderSignInChannel } from "../channels/provider-sign-in.channel.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../rules/dataverse-environment-service.rules.ts";
import { partitionSuppressedEvents } from "../rules/erasure-suppression.rules.ts";
import { MICROSOFT_GRAPH_SCOPE } from "../rules/microsoft-graph-seats.rules.ts";
import {
  listingDay,
  type PeopleListing,
  type PeopleListingRefusal,
  peopleRefused,
  personListingEvents,
} from "../rules/people-listing.rules.ts";
import { refusalFromListingThrow } from "../rules/provider-sign-in.rules.ts";
import { databricksGeniePullConfigSchema } from "./databricks-genie-puller.service.ts";
import type { ErasureSuppressionService } from "./erasure-suppression.service.ts";
import type { PersonDiscoveryService } from "./person-discovery.service.ts";
import { DATABRICKS_GENIE_ADAPTER_ID } from "./pull-destination.service.ts";
import type {
  SourceCredentialAccessService,
  SourceCredentialContext,
} from "./source-credential-access.service.ts";

/**
 * `named` is everyone the directory named; `withheld` is the subset erasure suppression removed —
 * never an addition to it — and `recorded` is their difference. `withheld` is safe as a current
 * figure, never as a series: its moment of change identifies an erasure.
 */
export type PeopleSyncResult =
  | { outcome: "listed"; recorded: number; named: number; withheld: number }
  | { outcome: "empty" }
  | { outcome: "refused"; refusal: PeopleListingRefusal };

const NOT_CONFIGURED: PeopleListingRefusal = { reason: "not_configured", status: null };

type ProviderListingRequest = {
  context: SourceCredentialContext;
  signal?: AbortSignal;
};

interface PersonListingDependencies {
  sourceCredentials: SourceCredentialAccessService;
  suppression: ErasureSuppressionService;
  discovery: PersonDiscoveryService;
  signIn: ProviderSignInChannel;
  adminApiUsers: AdminApiUsersChannel;
  microsoftDirectory: MicrosoftDirectoryChannel;
  databricksScimUsers: DatabricksScimUsersChannel;
  logger: Logger;
}

/**
 * Asks a provider who works there and records what it said, through the erasure check first.
 * Each branch parses its config before any request and scopes its `try` to the network calls,
 * so "not configured" means that and only that. Spec: governance-people-discovery.feature
 */
export class PersonListingService {
  private constructor(private readonly deps: PersonListingDependencies) {}

  static create({
    logger = createLogger("langwatch:governance:person-listing"),
    ...deps
  }: Omit<PersonListingDependencies, "logger"> & { logger?: Logger }): PersonListingService {
    return new PersonListingService({ ...deps, logger });
  }

  /** `now` is passed in so a sweep stamps every source with one day. */
  async syncFromSource({
    organizationId,
    ingestionSourceId,
    now,
    signal,
  }: {
    organizationId: string;
    ingestionSourceId: string;
    now: Instant;
    signal?: AbortSignal;
  }): Promise<PeopleSyncResult> {
    const { provider, listing } = await this.deps.sourceCredentials.withSourceCredentials({
      organizationId,
      ingestionSourceId,
      use: async (context) => ({
        provider: context.sourceType,
        listing: await this.listPeopleFromProvider({ context, signal }),
      }),
    });

    if (listing.outcome === "refused") {
      this.deps.logger.warn(
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

    const events = personListingEvents({ people: listing.items, provider, day: listingDay(now) });

    const suppression = await this.deps.suppression.loadForProvider({ organizationId, provider });
    const { kept, suppressedCount } = partitionSuppressedEvents({
      events,
      actorOf: (event) => event.actor,
      suppression,
    });
    if (suppressedCount > 0) {
      this.deps.logger.info(
        { organizationId, ingestionSourceId, suppressedCount },
        "skipped listed people naming an erased identifier",
      );
    }

    const { discovered } = await this.deps.discovery.recordFromPulledEvents({
      organizationId,
      provider,
      events: kept,
    });

    return {
      outcome: "listed",
      recorded: discovered,
      named: events.length,
      withheld: suppressedCount,
    };
  }

  private async listPeopleFromProvider(request: ProviderListingRequest): Promise<PeopleListing> {
    const { sourceType } = request.context;
    if (sourceType === ANTHROPIC_ADMIN_ADAPTER_ID) {
      return this.listFromAdminApi({ ...request, vendor: "anthropic" });
    }
    if (sourceType === OPENAI_ADMIN_ADAPTER_ID) {
      return this.listFromAdminApi({ ...request, vendor: "openai" });
    }
    if (sourceType === COPILOT_STUDIO_DATAVERSE_ADAPTER_ID) {
      return this.listFromCopilotStudio(request);
    }
    if (sourceType === DATABRICKS_GENIE_ADAPTER_ID) return this.listFromDatabricksGenie(request);
    return peopleRefused(NOT_CONFIGURED);
  }

  private async listFromAdminApi({
    context,
    signal,
    vendor,
  }: ProviderListingRequest & { vendor: "anthropic" | "openai" }): Promise<PeopleListing> {
    const apiKey = context.credentials.token;
    if (!apiKey) return peopleRefused(NOT_CONFIGURED);
    try {
      return vendor === "anthropic"
        ? await this.deps.adminApiUsers.listAnthropicPeople({ apiKey, signal })
        : await this.deps.adminApiUsers.listOpenAiPeople({ apiKey, signal });
    } catch (error) {
      return peopleRefused(refusalFromListingThrow(error));
    }
  }

  private async listFromCopilotStudio({
    context,
    signal,
  }: ProviderListingRequest): Promise<PeopleListing> {
    const parsed = copilotStudioDataversePullConfigSchema.safeParse(context.config);
    if (!parsed.success) return peopleRefused(NOT_CONFIGURED);

    try {
      const token = await this.deps.signIn.getEnvironmentToken({
        credentials: context.credentials,
        environmentUrl: parsed.data.environmentUrl,
        scope: MICROSOFT_GRAPH_SCOPE,
        signal,
      });
      return await this.deps.microsoftDirectory.listPeople({ token, signal });
    } catch (error) {
      return peopleRefused(refusalFromListingThrow(error));
    }
  }

  private async listFromDatabricksGenie({
    context,
    signal,
  }: ProviderListingRequest): Promise<PeopleListing> {
    const parsed = databricksGeniePullConfigSchema.safeParse(context.config);
    if (!parsed.success) return peopleRefused(NOT_CONFIGURED);
    const { workspaceUrl } = parsed.data;

    try {
      const token = await this.deps.signIn.getWorkspaceToken({
        credentials: context.credentials,
        workspaceUrl,
        signal,
      });
      return await this.deps.databricksScimUsers.listPeople({ workspaceUrl, token, signal });
    } catch (error) {
      return peopleRefused(refusalFromListingThrow(error));
    }
  }
}
