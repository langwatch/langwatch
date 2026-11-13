import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
/**
 * api-key revokes an organisation's docs session keys from its own side once organization
 * records the playground session switched off (ADR-185, §9): api-key already depends on
 * organization, so organization calling api-key back would be a peer cycle.
 */
import {
  ORGANIZATION_DOCS_PLAYGROUND_SESSIONS_DISABLED_EVENT_TYPE,
  organizationDocsPlaygroundSessionsDisabledEventDataSchema,
} from "@langwatch/organization-contract";

import type { ApiKeyModule } from "../app/api-key.app.ts";
import type { ApiKeyRepositories } from "../repositories/api-key.repositories.ts";
import type { DocsSessionKeyService } from "../services/docs-session-key.service.ts";

const DOCS_PLAYGROUND_REVOCATION_PIPELINE_NAME = "api_key_docs_playground_revocation" as const;

const disabledAtOf = organizationDocsPlaygroundSessionsDisabledEventDataSchema.pick({
  occurredAt: true,
});

export type DocsPlaygroundRevocationPipeline = StaticPipelineDefinition<never>;

export function buildDocsPlaygroundRevocationPipeline({
  docsSessionKeys,
}: {
  docsSessionKeys: Pick<DocsSessionKeyService, "revokeForOrganization">;
}): DocsPlaygroundRevocationPipeline {
  return (
    definePipeline({
      name: DOCS_PLAYGROUND_REVOCATION_PIPELINE_NAME,
      // `global`: api-key appends no events here; it only reacts to organization's fact.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // The revoke re-reads the live keys, so a redelivery finds none left to revoke.
      .withPeerSubscriber("apiKeyDocsPlaygroundSessionsDisabled", {
        eventType: ORGANIZATION_DOCS_PLAYGROUND_SESSIONS_DISABLED_EVENT_TYPE,
        data: organizationDocsPlaygroundSessionsDisabledEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) =>
              `api-key-docs-playground-disabled:${event.tenantId}:${String(event.aggregateId)}:${disabledAtOf.parse(event.data).occurredAt}`,
            ttlMs: 60_000,
          },
        },
        handle: async ({ organizationId }) => {
          await docsSessionKeys.revokeForOrganization({ organizationId });
        },
      })
      .build()
  );
}

export const docsPlaygroundRevocationEventing = defineEventingModule({
  pipeline: DOCS_PLAYGROUND_REVOCATION_PIPELINE_NAME,
  build: ({ app }: EventingSetup<ApiKeyRepositories, ApiKeyModule>) =>
    app.docsPlaygroundRevocationPipeline(),
});
