/**
 * The server half of `signingKeys.*` (ADR-183 §4 and §9). Whoever may braid out of a project
 * manages its keys: each key procedure asks `braids:manage` at the input's project. Writes need
 * Enterprise naming BRAIDS; the list stays open. `projectSigning` asks the braid door's read.
 */
import { ApiKeyApi, signingKeyTrpc } from "@langwatch/api-key-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";

/** The row names the organization holding the key's project, beside the project (E10). */
const ORGANIZATION_OF_PROJECT = { target: "organization", via: "projectId" } as const;

export const signingKeyTrpcTransport: TrpcRouterDeclaration<ApiKeyApi, typeof signingKeyTrpc> =
  defineTrpcRouter(ApiKeyApi, signingKeyTrpc)
    .procedure("list")
    .withPermission("braids:manage")
    .handle(({ app, input }) => app.findSigningKeys({ projectId: input.projectId }))

    // The braid dialog's switch: whoever braids into a project reads its traces (ADR-183 §2).
    .procedure("projectSigning")
    .withPermission("traces:view")
    .handle(({ app, input }) => app.findProjectSigning({ projectId: input.projectId }))

    .procedure("create")
    .mintsCredential("braids:manage")
    .withEntitlement("enterprise", { feature: "BRAIDS" })
    .withAudit(ORGANIZATION_OF_PROJECT)
    .withPermission("braids:manage")
    .handle(({ app, input, actor }) =>
      app.createSigningKey({ projectId: input.projectId, name: input.name, userId: actor.id }),
    )

    .procedure("rotate")
    .mintsCredential("braids:manage")
    .withEntitlement("enterprise", { feature: "BRAIDS" })
    .withAudit(ORGANIZATION_OF_PROJECT)
    .withPermission("braids:manage")
    .handle(({ app, input, actor }) =>
      app.rotateSigningKey({ projectId: input.projectId, keyId: input.keyId, userId: actor.id }),
    )

    .procedure("revoke")
    .withEntitlement("enterprise", { feature: "BRAIDS" })
    .withAudit(ORGANIZATION_OF_PROJECT)
    .withPermission("braids:manage")
    .handle(({ app, input }) =>
      app.revokeSigningKey({ projectId: input.projectId, keyId: input.keyId }),
    )
    .build();
