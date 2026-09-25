// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The CLI governance plane under `/api/auth/cli`. */
import { anyAuthenticated } from "@langwatch/api/access";
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
  governanceCliKeyLookupParamsSchema,
  governanceCliSourceEventsQuerySchema,
  governanceCliSourceParamsSchema,
  governanceCliSourcesQuerySchema,
} from "@langwatch/enterprise-governance-contract";

const JSON_MEDIA_TYPE = "application/json";
const CLI_DOOR = anyAuthenticated({
  reason:
    "the CLI token door admits the device-session bearer; each operation gates on the plan, the organization permission and, for key-minting routes, the active seat",
});

export const governanceCliRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("governance-cli")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })
  .withCredential("cliToken")
  .get("/api/auth/cli/budget/status", "readCliBudgetStatus")
  .withAccess(CLI_DOOR)
  .responds(governanceCliBudgetStatusAnswers)
  .handle(({ app, actor, scope }) => app.cliBudgetStatus({ actor, organizationId: scope.id }))
  .get("/api/auth/cli/bootstrap", "readCliBootstrap")
  .withAccess(CLI_DOOR)
  .responds(governanceCliBootstrapAnswers)
  .handle(({ app, actor, scope }) => app.cliBootstrapRead({ actor, organizationId: scope.id }))
  .get("/api/auth/cli/budget-overview", "readCliBudgetOverview")
  .withAccess(CLI_DOOR)
  .responds(governanceCliBudgetOverviewAnswers)
  .handle(({ app, actor, scope }) => app.cliBudgetOverview({ actor, organizationId: scope.id }))
  .get("/api/auth/cli/personal-project", "readCliPersonalProject")
  .withAccess(CLI_DOOR)
  .responds(governanceCliPersonalProjectAnswers)
  .handle(({ app, actor, scope }) => app.cliPersonalProject({ actor, organizationId: scope.id }))
  .post("/api/auth/cli/virtual-key", "issueCliVirtualKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .responds(governanceCliVirtualKeyAnswers)
  .handle(({ app, actor, scope, raw }) =>
    app.cliVirtualKey({ actor, organizationId: scope.id, raw }),
  )
  .post("/api/auth/cli/project-key", "readCliProjectKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .responds(governanceCliProjectKeyAnswers)
  .handle(({ app, actor, scope, raw }) =>
    app.cliProjectKey({ actor, organizationId: scope.id, raw }),
  )
  .get("/api/auth/cli/governance/ingest/sources", "listCliIngestionSources")
  .withQuery(governanceCliSourcesQuerySchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionSourcesAnswers)
  .handle(({ app, actor, scope, input }) =>
    app.cliIngestionSources({
      actor,
      organizationId: scope.id,
      includeArchived: input.include_archived,
    }),
  )
  .get("/api/auth/cli/governance/ingest/sources/:sourceId/events", "listCliIngestionSourceEvents")
  .withParams(governanceCliSourceParamsSchema)
  .withQuery(governanceCliSourceEventsQuerySchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionSourceEventsAnswers)
  .handle(({ app, actor, scope, input }) =>
    app.cliIngestionSourceEvents({
      actor,
      organizationId: scope.id,
      sourceId: input.sourceId,
      limit: input.limit,
      beforeIso: input.before_iso,
    }),
  )
  .get("/api/auth/cli/governance/ingest/sources/:sourceId/health", "readCliIngestionSourceHealth")
  .withParams(governanceCliSourceParamsSchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionSourceHealthAnswers)
  .handle(({ app, actor, scope, input }) =>
    app.cliIngestionSourceHealth({ actor, organizationId: scope.id, sourceId: input.sourceId }),
  )
  .get("/api/auth/cli/governance/status", "readCliGovernanceStatus")
  .withAccess(CLI_DOOR)
  .responds(governanceCliGovernanceStatusAnswers)
  .handle(({ app, actor, scope }) => app.cliGovernanceStatus({ actor, organizationId: scope.id }))
  .get("/api/auth/cli/governance/ingestion-templates", "listCliIngestionTemplates")
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionTemplatesAnswers)
  .handle(({ app, actor, scope }) => app.cliIngestionTemplates({ actor, organizationId: scope.id }))
  .post("/api/auth/cli/governance/ingestion-key", "mintCliIngestionKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionKeyAnswers)
  .handle(({ app, actor, scope, raw }) =>
    app.cliIngestionKey({ actor, organizationId: scope.id, raw }),
  )
  .get("/api/auth/cli/governance/ingestion-keys", "listCliIngestionKeys")
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionKeysAnswers)
  .handle(({ app, actor, scope }) => app.cliIngestionKeys({ actor, organizationId: scope.id }))
  .get("/api/auth/cli/governance/ingestion-keys/:lookup_id", "readCliIngestionKeyState")
  .withParams(governanceCliKeyLookupParamsSchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionKeyStateAnswers)
  .handle(({ app, actor, scope, input }) =>
    app.cliIngestionKeyState({ actor, organizationId: scope.id, lookupId: input.lookup_id }),
  )
  .build();
