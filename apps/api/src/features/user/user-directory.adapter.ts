/**
 * The user directory in the shape Better Auth, SCIM and the back office still
 * name it. The module keeps its directory service private, so this delegates
 * every operation `UserApi` answers and refuses the three it does not.
 */
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { UserService } from "@langwatch/user-contract";

/**
 * A plain `Error` on purpose: nothing the caller sent causes it and nothing
 * they can send avoids it. It is a fact about what the user module publishes.
 */
function unpublished(processName: string, operation: string): Error {
  return new Error(
    `${processName} reaches the user directory through its application, which does not publish ${operation}.`,
  );
}

/**
 * Wraps the composed application so a `UserService` caller keeps working. The
 * three refusals are the address lookup and the two account mints: answering
 * them here would copy row writes the module owns, and that is two directories.
 */
export function createApiUserDirectory(options: {
  users: UserApi;
  /** Names this process in the refusal the three unbacked calls answer with. */
  processName: string;
}): UserService {
  const { users, processName } = options;
  const refuse = (operation: string): Promise<never> =>
    Promise.reject(unpublished(processName, operation));

  return {
    getProfiles: (input) => users.getProfiles(input),
    tryFindById: (input) => users.tryFindById(input),
    tryFindByEmail: (): Promise<UserProfile | null> =>
      refuse("looking an account up by address"),
    create: () => refuse("creating an account"),
    createCredentialUser: (input) => users.createCredentialUser(input),
    createPasskeyUser: () => refuse("creating a passkey account"),
    hasPassword: (input) => users.hasPassword(input),
    setFirstPassword: (input) => users.setFirstPassword(input),
    getPasskeyNudgeStatus: (input) => users.getPasskeyNudgeStatus(input),
    dismissPasskeyNudge: (input) => users.dismissPasskeyNudge(input),
    updateProfile: (input) => users.updateProfile(input),
    getAccountInfo: (input) => users.getAccountInfo(input),
    getSsoStatus: (input) => users.getSsoStatus(input),
    getTraceExplorerTourPreference: (input) => users.getTraceExplorerTourPreference(input),
    dismissTraceExplorerTour: (input) => users.dismissTraceExplorerTour(input),
    updateLastLogin: (input) => users.updateLastLogin(input),
    tryGetLastHomePath: (input) => users.tryGetLastHomePath(input),
    setLastHomePath: (input) => users.setLastHomePath(input),
    deactivate: (input) => users.deactivate(input),
    reactivate: (input) => users.reactivate(input),
    setAvatar: (input) => users.setAvatar(input),
    removeAvatar: (input) => users.removeAvatar(input),
  };
}
