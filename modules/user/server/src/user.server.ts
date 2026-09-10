import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import type { MePersonalCredential } from "@langwatch/user-contract";
import { defineServerModule } from "@langwatch/runtime-composition";
import { UserApp } from "./app/user.app.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";
import { identityTrpcTransport } from "./transport/identity.trpc.ts";
import { mePersonalCredential, meRest } from "./transport/me.rest.ts";
import { userAvatarRest } from "./transport/user-avatar.rest.ts";
import { userTrpcTransport } from "./transport/user.trpc.ts";

export type {
  UserAnalytics,
  UserAvatarObjects,
  UserAvatarStorage,
  UserBudgetCheckInput,
  UserBudgetDecision,
  UserBudgetRequestMailer,
  UserBudgetScopeDecision,
  UserCliCredentials,
  UserDeployment,
  UserFederatedPasswordOutcome,
  UserFederatedPasswords,
  UserGatewayGovernance,
  UserInfrastructure,
  UserKeyProject,
  UserOrganizationDirectory,
  UserPasswordHasher,
  UserPersonalUsageReader,
  UserProjectDirectory,
  UserRateLimiter,
  UserVerificationCeremony,
} from "./app/user.app.ts";

export const userServer = defineServerModule("user")
  .withRepositories(userRepositories)
  .withApp(UserApp)
  .withTransports(meRest, userAvatarRest, userTrpcTransport, identityTrpcTransport)
  // The credential whole rather than in pieces: a personal-usage answer is
  // refused for a key that is not the asking member's own, and the door's
  // answer is the only place that can be read from.
  .withTransportFacts(() => [
    bindRestMiddleware(mePersonalCredential, (context): MePersonalCredential => {
      const credential = projectCredentialOfRequest(context.req.raw);
      if (credential.type !== "apiKey") return { kind: "legacyProjectKey" };

      return {
        kind: "apiKey",
        userId: credential.userId,
        organizationId: credential.organizationId,
      };
    }),
  ])
  .build();
