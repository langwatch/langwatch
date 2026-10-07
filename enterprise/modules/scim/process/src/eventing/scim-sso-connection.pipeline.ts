// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type FoldProjectionStore,
} from "@langwatch/eventing";

import type { ScimModule } from "../app/scim.app.ts";
import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import {
  type ScimSsoConnectionFoldState,
  scimSsoConnectionPeerFold,
} from "./scim-sso-connection.projection.ts";

/** Hosts SCIM's peer fold over identity's connection facts; it records no event of its own. */
export const SCIM_SSO_CONNECTION_PIPELINE_NAME = "scim_sso_connections" as const;

function scimSsoConnectionHost(store: FoldProjectionStore<ScimSsoConnectionFoldState>) {
  return definePipeline({
    name: SCIM_SSO_CONNECTION_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "scim_sso_connection_view" }),
  })
    .withEvents([])
    .withPeerFoldProjection(scimSsoConnectionPeerFold(store));
}

/** The host pipeline as a TYPE, derived from the builder above. */
export type ScimSsoConnectionPipeline = ReturnType<
  ReturnType<typeof scimSsoConnectionHost>["build"]
>;

export function buildScimSsoConnectionPipeline(
  store: FoldProjectionStore<ScimSsoConnectionFoldState>,
): ScimSsoConnectionPipeline {
  return scimSsoConnectionHost(store).build();
}

export const scimSsoConnectionEventing = defineEventingModule({
  pipeline: SCIM_SSO_CONNECTION_PIPELINE_NAME,
  build: ({ repositories }: EventingSetup<ScimRepositories, ScimModule>) =>
    buildScimSsoConnectionPipeline(repositories.scimSsoConnections),
});
