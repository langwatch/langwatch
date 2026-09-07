export { PostgresUserAdapter } from "./adapters/postgres.user.adapter.ts";
export {
  PostgresUserCredentialAdapter,
  type PostgresUserCredentialAdapterOptions,
  type UserCredentialDatabase,
} from "./adapters/postgres.user-signin-credential.adapter.ts";
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  UserApp,
  type UserAppDependencies,
} from "./app/user.app.ts";
export { UserAvatarStoragePort, UserPasswordHasherPort } from "./ports/user.port.ts";
export {
  UserCredentialService,
  type UserPasswordRotationOutcome,
} from "./services/user-signin-credential.service.ts";
export { UserService } from "./services/user.service.ts";
export {
  runGdprUserDataErase,
  UserDataEraseTask,
  type GdprUserDataEraseOutcome,
} from "./tasks/user-data-erase.task.ts";
export { PostgresUserDataEraseAdapter } from "./adapters/postgres.user-data-erase.adapter.ts";
export {
  IdentityTrpcApi,
  type IdentityTrpcContext,
  type IdentityTrpcPorts,
} from "./transport/api-trpc/identity.api.ts";
export {
  UserTrpcApi,
  type Auth0PasswordChangeOutcome,
  type UnlinkAccountOutcome,
  type UserTrpcContext,
  type UserTrpcPorts,
} from "./transport/api-trpc/user.api.ts";
export { createMeRestApp, type MePersonalUsageReader } from "./transport/api-rest/me.api.ts";
export {
  createUserAvatarRestApp,
  type UserAvatarDualAuthVariables,
  type UserAvatarObjectReader,
  type UserAvatarRateLimiter,
  type UserAvatarStoredObjectRead,
} from "./transport/api-rest/user-avatar.api.ts";
