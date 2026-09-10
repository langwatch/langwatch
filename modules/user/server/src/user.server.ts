import { defineServerModule } from "@langwatch/runtime-composition";
import { UserApp } from "./app/user.app.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";
import { identityTrpcTransport } from "./transport/identity.trpc.ts";
import { meRest } from "./transport/me.rest.ts";
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
  .build();
