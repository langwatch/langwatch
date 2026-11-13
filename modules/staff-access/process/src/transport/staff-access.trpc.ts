/**
 * The operator's agents page and approval page. Every procedure asks `ops:manage` on the
 * platform, which an impersonated session never holds, and answers `not_found` while off.
 * Spec: modules/staff-access/specs/staff-access-approval.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { StaffAccessApi, staffAccessTrpc } from "@langwatch/staff-access-contract";

const OPERATOR = { at: "platform", refusal: "hidden" } as const;

export const staffAccessTrpcTransport: TrpcRouterDeclaration<
  StaffAccessApi,
  typeof staffAccessTrpc
> = defineTrpcRouter(StaffAccessApi, staffAccessTrpc)
  .procedure("overview")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor }) => app.overview({ actor }))

  .procedure("enrolOptions")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor }) => app.enrolOptions({ actor }))

  .procedure("enrol")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.enrol({ actor, ...input }))

  .procedure("revokeRequester")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.revokeRequester({ actor, ...input }))

  .procedure("getApprovalRequest")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.getApprovalRequest({ actor, ...input }))

  .procedure("approvalOptions")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.approvalOptions({ actor, ...input }))

  .procedure("approve")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.approve({ actor, ...input }))

  .procedure("deny")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.deny({ actor, ...input }))

  .procedure("revokeSession")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.revokeSession({ actor, ...input }))

  .procedure("revokeAll")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, actor, input }) => app.revokeAll({ actor, ...input }))
  .build();
