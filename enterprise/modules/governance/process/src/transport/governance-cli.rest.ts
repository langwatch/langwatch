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
  governanceCliProjectKeyGoneAnswers,
  governanceCliVirtualKeyAnswers,
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
  governanceCliSessionSchema,
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
  .withCredential("cliToken", { session: governanceCliSessionSchema })
  .get("/api/auth/cli/budget/status", "readCliBudgetStatus")
  .withAccess(CLI_DOOR)
  .responds(governanceCliBudgetStatusAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliBudgetStatus({ actor, session, organizationId: scope.id }),
  )
  .get("/api/auth/cli/bootstrap", "readCliBootstrap")
  .withAccess(CLI_DOOR)
  .responds(governanceCliBootstrapAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliBootstrapRead({ actor, session, organizationId: scope.id }),
  )
  .get("/api/auth/cli/budget-overview", "readCliBudgetOverview")
  .withAccess(CLI_DOOR)
  .responds(governanceCliBudgetOverviewAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliBudgetOverview({ actor, session, organizationId: scope.id }),
  )
  .get("/api/auth/cli/personal-project", "readCliPersonalProject")
  .withAccess(CLI_DOOR)
  .responds(governanceCliPersonalProjectAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliPersonalProject({ actor, session, organizationId: scope.id }),
  )
  // The deleted project-key door answers 410 so old CLIs upgrade (Alex, 2026-10-01). Remove
  // after a few releases. Old CLIs print only `error_description`, so the body keeps their shape.
  .post("/api/auth/cli/project-key", "readCliProjectKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .responds(governanceCliProjectKeyGoneAnswers)
  .handle(() => ({
    status: 410 as const,
    body: {
      error: "gone",
      error_description:
        "This version of the LangWatch CLI is too old to log in to a project. Run: npm i -g langwatch@latest",
    },
  }))
  .post("/api/auth/cli/virtual-key", "issueCliVirtualKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .responds(governanceCliVirtualKeyAnswers)
  .handle(({ app, actor, session, scope, raw }) =>
    app.cliVirtualKey({ actor, session, organizationId: scope.id, raw }),
  )
  .get("/api/auth/cli/governance/ingest/sources", "listCliIngestionSources")
  .withQuery(governanceCliSourcesQuerySchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionSourcesAnswers)
  .handle(({ app, actor, session, scope, input }) =>
    app.cliIngestionSources({
      actor,
      session,
      organizationId: scope.id,
      includeArchived: input.include_archived,
    }),
  )
  .get("/api/auth/cli/governance/ingest/sources/:sourceId/events", "listCliIngestionSourceEvents")
  .withParams(governanceCliSourceParamsSchema)
  .withQuery(governanceCliSourceEventsQuerySchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionSourceEventsAnswers)
  .handle(({ app, actor, session, scope, input }) =>
    app.cliIngestionSourceEvents({
      actor,
      session,
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
  .handle(({ app, actor, session, scope, input }) =>
    app.cliIngestionSourceHealth({
      actor,
      session,
      organizationId: scope.id,
      sourceId: input.sourceId,
    }),
  )
  .get("/api/auth/cli/governance/status", "readCliGovernanceStatus")
  .withAccess(CLI_DOOR)
  .responds(governanceCliGovernanceStatusAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliGovernanceStatus({ actor, session, organizationId: scope.id }),
  )
  .get("/api/auth/cli/governance/ingestion-templates", "listCliIngestionTemplates")
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionTemplatesAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliIngestionTemplates({ actor, session, organizationId: scope.id }),
  )
  .post("/api/auth/cli/governance/ingestion-key", "mintCliIngestionKey")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionKeyAnswers)
  .handle(({ app, actor, session, scope, raw }) =>
    app.cliIngestionKey({ actor, session, organizationId: scope.id, raw }),
  )
  .get("/api/auth/cli/governance/ingestion-keys", "listCliIngestionKeys")
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionKeysAnswers)
  .handle(({ app, actor, session, scope }) =>
    app.cliIngestionKeys({ actor, session, organizationId: scope.id }),
  )
  .get("/api/auth/cli/governance/ingestion-keys/:lookup_id", "readCliIngestionKeyState")
  .withParams(governanceCliKeyLookupParamsSchema)
  .withAccess(CLI_DOOR)
  .responds(governanceCliIngestionKeyStateAnswers)
  .handle(({ app, actor, session, scope, input }) =>
    app.cliIngestionKeyState({
      actor,
      session,
      organizationId: scope.id,
      lookupId: input.lookup_id,
    }),
  )
  .build();
