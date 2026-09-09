/**
 * The server half of `publicEnv`. Both answers are the application's; the
 * viewer's address and the operator allow-list are the PROCESS's, so each
 * arrives as a fact rather than off a context this declaration cannot see.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { publicEnvTrpc } from "@langwatch/auth-contract";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

/** The viewer's own address, where the request carried a session at all. */
export const viewerEmailFact = defineTrpcFact("viewerEmail", z.string().nullable());

/**
 * The addresses this deployment configured to see the operator entry, exactly
 * as it configured them. Null where it named none.
 */
export const operatorAllowListFact = defineTrpcFact(
  "operatorAllowList",
  z.array(z.string()).nullable(),
);

/**
 * What the public-environment reader calls. Declared here because `auth` has
 * no installer and no feature app yet: `AuthApp` satisfies it operation for
 * operation, and the process provides that app for this token.
 */
export interface PublicEnvApi {
  /** Which sign-in mode the deployment offers. ADR-027's one source of truth. */
  resolveAuthProvider(): Promise<string>;
  /** Whether this viewer sees the operator entry in the sidebar. */
  showsOperatorEntry(
    userEmail: string | null | undefined,
    allowList: readonly string[] | undefined,
  ): boolean;
}

export const PublicEnvApi = featureApi<PublicEnvApi>("auth");

const PUBLIC_ENV_ACCESS = publicRoute({
  reason:
    "the sign-in page asks this before anybody has a session; it resolves sign-in mode and viewer UI visibility only, and reads no tenant product data",
});

export const publicEnvTrpcTransport = defineTrpcRouter(PublicEnvApi, publicEnvTrpc)
  .procedure("publicEnv")
  .withFacts(viewerEmailFact, operatorAllowListFact)
  .withAccess(PUBLIC_ENV_ACCESS)
  .handle(async ({ app }, viewerEmail, allowList) => ({
    NEXTAUTH_PROVIDER: await app.resolveAuthProvider(),
    SHOW_OPS_IN_MAIN_SIDEBAR: app.showsOperatorEntry(viewerEmail, allowList ?? undefined),
  }))
  .build();
