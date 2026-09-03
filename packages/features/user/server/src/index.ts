export { PostgresUserAdapter } from "./adapters/postgres.user.adapter";
export {
  PostgresUserCredentialAdapter,
  type PostgresUserCredentialAdapterOptions,
  type UserCredentialDatabase,
} from "./adapters/postgres.user-credential.adapter";
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  UserApp,
  type UserAppDependencies,
} from "./app/user.app";
export { UserAvatarStoragePort, UserPasswordHasherPort } from "./ports/user.port";
export {
  UserCredentialService,
  type UserPasswordRotationOutcome,
} from "./services/user-credential.service";
export { UserService } from "./services/user.service";
export {
  runGdprUserDataErase,
  UserDataEraseTask,
  type GdprUserDataEraseDatabase,
  type GdprUserDataEraseOutcome,
} from "./tasks/user-data-erase.task";
export {
  IdentityTrpcApi,
  type IdentityTrpcContext,
  type IdentityTrpcPorts,
} from "./transport/api-trpc/identity.api";
export {
  UserTrpcApi,
  type Auth0PasswordChangeOutcome,
  type UnlinkAccountOutcome,
  type UserTrpcContext,
  type UserTrpcPorts,
} from "./transport/api-trpc/user.api";
export { createMeRestApp, type MePersonalUsageReader } from "./transport/api-rest/me.api";
export {
  createUserAvatarRestApp,
  type UserAvatarDualAuthVariables,
  type UserAvatarObjectReader,
  type UserAvatarRateLimiter,
  type UserAvatarStoredObjectRead,
} from "./transport/api-rest/user-avatar.api";
