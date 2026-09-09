export { PostgresUserAdapter } from "./adapters/postgres.user.adapter.ts";
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  UserApp,
  type UserInfrastructure,
} from "./app/user.app.ts";
export { UserAvatarStoragePort, UserPasswordHasherPort } from "./ports/user.port.ts";
export { UserService } from "./services/user.service.ts";
export { UserAccountService } from "./services/user-account.service.ts";
export {
  runGdprUserDataErase,
  UserDataEraseTask,
  type GdprUserDataEraseOutcome,
} from "./tasks/user-data-erase.task.ts";
export { PostgresUserDataEraseAdapter } from "./adapters/postgres.user-data-erase.adapter.ts";
// The two tRPC transports are not exported: they still name the deleted legacy
// builder.
export { createMeRestApp, type MePersonalUsageReader } from "./transport/api-rest/me.api.ts";
export { userServer } from "./user.server.ts";
export {
  createUserAvatarRestApp,
  type UserAvatarDualAuthVariables,
  type UserAvatarObjectReader,
  type UserAvatarRateLimiter,
  type UserAvatarStoredObjectRead,
} from "./transport/api-rest/user-avatar.api.ts";
