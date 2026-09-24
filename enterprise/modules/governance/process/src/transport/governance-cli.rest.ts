// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The CLI governance plane under `/api/auth/cli`. */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  GovernanceRestApi,
  governanceCliBudgetStatusAnswers,
  governanceCliBootstrapAnswers,
  governanceCliBudgetOverviewAnswers,
  governanceCliPersonalProjectAnswers,
  governanceCliVirtualKeyAnswers,
  governanceCliProjectKeyAnswers,
  governanceCliIngestionSourcesAnswers,
  governanceCliIngestionSourceEventsAnswers,
  governanceCliIngestionSourceHealthAnswers,
  governanceCliGovernanceStatusAnswers,
  governanceCliIngestionTemplatesAnswers,
  governanceCliIngestionKeyAnswers,
  governanceCliIngestionKeysAnswers,
  governanceCliIngestionKeyStateAnswers,
  governanceCliHeadersSchema,
  governanceCliKeyLookupParamsSchema,
  governanceCliSourceEventsQuerySchema,
  governanceCliSourceParamsSchema,
  governanceCliSourcesQuerySchema,
} from "@langwatch/enterprise-governance-contract";

const JSON_MEDIA_TYPE = "application/json";
const CLI_DOOR = publicRoute({
  reason:
    "the CLI governance plane authenticates its caller inside its own handlers from a device-session bearer, gates on the plan and the organization permission there, and answers its own 401, 402, 403 and RFC 8628-shaped refusals",
});

export const governanceCliRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("governance-cli")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })
  .get("/api/auth/cli/budget/status", "readCliBudgetStatus")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliBudgetStatusAnswers)
  .handle(({ app }, { authorization }) => app.cliBudgetStatus({ authorization }))
  .get("/api/auth/cli/bootstrap", "readCliBootstrap")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliBootstrapAnswers)
  .handle(({ app }, { authorization }) => app.cliBootstrapRead({ authorization }))
  .get("/api/auth/cli/budget-overview", "readCliBudgetOverview")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliBudgetOverviewAnswers)
  .handle(({ app }, { authorization }) => app.cliBudgetOverview({ authorization }))
  .get("/api/auth/cli/personal-project", "readCliPersonalProject")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliPersonalProjectAnswers)
  .handle(({ app }, { authorization }) => app.cliPersonalProject({ authorization }))
  .post("/api/auth/cli/virtual-key", "issueCliVirtualKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliVirtualKeyAnswers)
  .handle(({ app, raw }, { authorization }) => app.cliVirtualKey({ authorization, raw }))
  .post("/api/auth/cli/project-key", "readCliProjectKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliProjectKeyAnswers)
  .handle(({ app, raw }, { authorization }) => app.cliProjectKey({ authorization, raw }))
  .get("/api/auth/cli/governance/ingest/sources", "listCliIngestionSources")
  .withQuery(governanceCliSourcesQuerySchema)
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionSourcesAnswers)
  .handle(({ app, input }, { authorization }) =>
    app.cliIngestionSources({ authorization, includeArchived: input.include_archived }),
  )
  .get("/api/auth/cli/governance/ingest/sources/:sourceId/events", "listCliIngestionSourceEvents")
  .withParams(governanceCliSourceParamsSchema)
  .withQuery(governanceCliSourceEventsQuerySchema)
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionSourceEventsAnswers)
  .handle(({ app, input }, { authorization }) =>
    app.cliIngestionSourceEvents({
      authorization,
      sourceId: input.sourceId,
      limit: input.limit,
      beforeIso: input.before_iso,
    }),
  )
  .get("/api/auth/cli/governance/ingest/sources/:sourceId/health", "readCliIngestionSourceHealth")
  .withParams(governanceCliSourceParamsSchema)
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionSourceHealthAnswers)
  .handle(({ app, input }, { authorization }) =>
    app.cliIngestionSourceHealth({ authorization, sourceId: input.sourceId }),
  )
  .get("/api/auth/cli/governance/status", "readCliGovernanceStatus")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliGovernanceStatusAnswers)
  .handle(({ app }, { authorization }) => app.cliGovernanceStatus({ authorization }))
  .get("/api/auth/cli/governance/ingestion-templates", "listCliIngestionTemplates")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionTemplatesAnswers)
  .handle(({ app }, { authorization }) => app.cliIngestionTemplates({ authorization }))
  .post("/api/auth/cli/governance/ingestion-key", "mintCliIngestionKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionKeyAnswers)
  .handle(({ app, raw }, { authorization }) => app.cliIngestionKey({ authorization, raw }))
  .get("/api/auth/cli/governance/ingestion-keys", "listCliIngestionKeys")
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionKeysAnswers)
  .handle(({ app }, { authorization }) => app.cliIngestionKeys({ authorization }))
  .get("/api/auth/cli/governance/ingestion-keys/:lookup_id", "readCliIngestionKeyState")
  .withParams(governanceCliKeyLookupParamsSchema)
  .withAccess(CLI_DOOR)
  .withHeaders(governanceCliHeadersSchema)
  .responds(governanceCliIngestionKeyStateAnswers)
  .handle(({ app, input }, { authorization }) =>
    app.cliIngestionKeyState({ authorization, lookupId: input.lookup_id }),
  )
  .build();
