/**
 * The server half of `organizationSeatPeak.*` (ADR-002): our own team's renewal read. The door
 * admits ops:manage at the platform and hides the surface (404) from everyone else.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OrganizationApi, organizationSeatPeakTrpc } from "@langwatch/organization-contract";

/** Platform operators only, as every ops read; nobody else learns the route exists. */
const OPERATOR = { at: "platform", refusal: "hidden" } as const;

export const seatPeakTrpcTransport: TrpcRouterDeclaration<
  OrganizationApi,
  typeof organizationSeatPeakTrpc
> = defineTrpcRouter(OrganizationApi, organizationSeatPeakTrpc)
  .procedure("get")
  .withPermission("ops:manage", OPERATOR)
  .handle(({ app, input }) => app.getSeatPeak({ organizationId: input.organizationId }))
  .build();
