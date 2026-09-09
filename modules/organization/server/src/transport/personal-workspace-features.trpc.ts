/**
 * The server half of `personalWorkspaceFeatures.*`. Authorized by the caller
 * being the project's owner, which the application proves, rather than by an
 * organization permission: the bundle is a navigation predicate, so switching
 * it off hides navigation and deletes nothing.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OrganizationApi, personalWorkspaceFeaturesTrpc } from "@langwatch/organization-contract";

const OWNED_BY_ITS_OWNER = {
  reason: "a personal workspace belongs to its owner, not a team",
  allow: {
    projectId:
      "the application asserts the project is personal and owned by the caller before answering",
  },
} as const;

export const personalWorkspaceFeaturesTrpcTransport = defineTrpcRouter(
  OrganizationApi,
  personalWorkspaceFeaturesTrpc,
)
  .procedure("get")
  .noPermission(OWNED_BY_ITS_OWNER)
  .handle(({ app, input, actor }) =>
    app.readPersonalWorkspaceFeatures({ projectId: input.projectId }, { id: actor.id }),
  )

  .procedure("enableAll")
  .noPermission(OWNED_BY_ITS_OWNER)
  .handle(({ app, input, actor }) =>
    app.enablePersonalWorkspaceFeatures({ projectId: input.projectId }, { id: actor.id }),
  )

  .procedure("disableAll")
  .noPermission(OWNED_BY_ITS_OWNER)
  .handle(({ app, input, actor }) =>
    app.disablePersonalWorkspaceFeatures({ projectId: input.projectId }, { id: actor.id }),
  )
  .build();
