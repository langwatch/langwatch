/**
 * The server half of `connect.*`. Every decision is the application's; this
 * names the permission each one needs (ADR-156, section 9).
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { LicensingApi, connectTrpc } from "@langwatch/enterprise-licensing-contract";

/**
 * Reading is any member's: the page explains why hosted judging is or is not
 * running. Both writes are an organization management right:
 * what leaves the install and what it may spend.
 */
export const connectTrpcTransport = defineTrpcRouter(LicensingApi, connectTrpc)
  .procedure("status")
  .withPermission("organization:view")
  .handle(({ app, input }) => app.getConnectStatus(input))

  .procedure("setService")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.setConnectService(input))

  .procedure("setCap")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.setConnectCap(input))
  .build();
