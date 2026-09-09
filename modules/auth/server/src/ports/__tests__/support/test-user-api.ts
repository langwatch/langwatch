import type { UserApi } from "@langwatch/user-contract";

/**
 * A complete `UserApi` fake, so a suite stays at the module boundary: the
 * operations a test cares about are overridden and everything else refuses by
 * name.
 */
export class TestUserApi implements UserApi {
  constructor(private readonly overrides: Partial<UserApi> = {}) {}

  tryFindById: UserApi["tryFindById"] = (input) =>
    this.overrides.tryFindById?.(input) ?? this.unimplemented("tryFindById");

  updateProfile: UserApi["updateProfile"] = (input) =>
    this.overrides.updateProfile?.(input) ?? this.unimplemented("updateProfile");

  personalCallerFor: UserApi["personalCallerFor"] = (input) =>
    this.overrides.personalCallerFor?.(input) ?? this.refuse("personalCallerFor");

  getProfiles: UserApi["getProfiles"] = (input) =>
    this.overrides.getProfiles?.(input) ?? this.unimplemented("getProfiles");

  getAccountInfo: UserApi["getAccountInfo"] = (input) =>
    this.overrides.getAccountInfo?.(input) ?? this.unimplemented("getAccountInfo");

  getSsoStatus: UserApi["getSsoStatus"] = (input) =>
    this.overrides.getSsoStatus?.(input) ?? this.unimplemented("getSsoStatus");

  updateLastLogin: UserApi["updateLastLogin"] = (input) =>
    this.overrides.updateLastLogin?.(input) ?? this.unimplemented("updateLastLogin");

  recordSignIn: UserApi["recordSignIn"] = (input) =>
    this.overrides.recordSignIn?.(input) ?? this.unimplemented("recordSignIn");

  getTraceExplorerTourPreference: UserApi["getTraceExplorerTourPreference"] = (input) =>
    this.overrides.getTraceExplorerTourPreference?.(input) ?? this.unimplemented("getTraceExplorerTourPreference");

  dismissTraceExplorerTour: UserApi["dismissTraceExplorerTour"] = (input) =>
    this.overrides.dismissTraceExplorerTour?.(input) ?? this.unimplemented("dismissTraceExplorerTour");

  isAdmin: UserApi["isAdmin"] = (identity) =>
    this.overrides.isAdmin?.(identity) ?? this.refuse("isAdmin");

  isOperator: UserApi["isOperator"] = (input) =>
    this.overrides.isOperator?.(input) ?? this.unimplemented("isOperator");

  findByEmail: UserApi["findByEmail"] = (input) =>
    this.overrides.findByEmail?.(input) ?? this.unimplemented("findByEmail");

  create: UserApi["create"] = (input) =>
    this.overrides.create?.(input) ?? this.unimplemented("create");

  createCredentialUser: UserApi["createCredentialUser"] = (input) =>
    this.overrides.createCredentialUser?.(input) ?? this.unimplemented("createCredentialUser");

  createPasskeyUser: UserApi["createPasskeyUser"] = (input) =>
    this.overrides.createPasskeyUser?.(input) ?? this.unimplemented("createPasskeyUser");

  registerCredentialAccount: UserApi["registerCredentialAccount"] = (input) =>
    this.overrides.registerCredentialAccount?.(input) ?? this.unimplemented("registerCredentialAccount");

  hasPassword: UserApi["hasPassword"] = (input) =>
    this.overrides.hasPassword?.(input) ?? this.unimplemented("hasPassword");

  setFirstPassword: UserApi["setFirstPassword"] = (input) =>
    this.overrides.setFirstPassword?.(input) ?? this.unimplemented("setFirstPassword");

  setOwnFirstPassword: UserApi["setOwnFirstPassword"] = (input) =>
    this.overrides.setOwnFirstPassword?.(input) ?? this.unimplemented("setOwnFirstPassword");

  changeOwnPassword: UserApi["changeOwnPassword"] = (input) =>
    this.overrides.changeOwnPassword?.(input) ?? this.unimplemented("changeOwnPassword");

  getPasskeyNudgeStatus: UserApi["getPasskeyNudgeStatus"] = (input) =>
    this.overrides.getPasskeyNudgeStatus?.(input) ?? this.unimplemented("getPasskeyNudgeStatus");

  getPasskeyOffer: UserApi["getPasskeyOffer"] = (input) =>
    this.overrides.getPasskeyOffer?.(input) ?? this.unimplemented("getPasskeyOffer");

  dismissPasskeyNudge: UserApi["dismissPasskeyNudge"] = (input) =>
    this.overrides.dismissPasskeyNudge?.(input) ?? this.unimplemented("dismissPasskeyNudge");

  rotatePassword: UserApi["rotatePassword"] = (input) =>
    this.overrides.rotatePassword?.(input) ?? this.unimplemented("rotatePassword");

  findAuth0DatabaseAccount: UserApi["findAuth0DatabaseAccount"] = (input) =>
    this.overrides.findAuth0DatabaseAccount?.(input) ?? this.unimplemented("findAuth0DatabaseAccount");

  listLinkedAccounts: UserApi["listLinkedAccounts"] = (input) =>
    this.overrides.listLinkedAccounts?.(input) ?? this.unimplemented("listLinkedAccounts");

  unlinkAccount: UserApi["unlinkAccount"] = (input) =>
    this.overrides.unlinkAccount?.(input) ?? this.unimplemented("unlinkAccount");

  unlinkOwnAccount: UserApi["unlinkOwnAccount"] = (input) =>
    this.overrides.unlinkOwnAccount?.(input) ?? this.unimplemented("unlinkOwnAccount");

  revokeOtherBrowserSessions: UserApi["revokeOtherBrowserSessions"] = (input) =>
    this.overrides.revokeOtherBrowserSessions?.(input) ?? this.unimplemented("revokeOtherBrowserSessions");

  revokeAllBrowserSessions: UserApi["revokeAllBrowserSessions"] = (input) =>
    this.overrides.revokeAllBrowserSessions?.(input) ?? this.unimplemented("revokeAllBrowserSessions");

  deactivate: UserApi["deactivate"] = (input) =>
    this.overrides.deactivate?.(input) ?? this.unimplemented("deactivate");

  reactivate: UserApi["reactivate"] = (input) =>
    this.overrides.reactivate?.(input) ?? this.unimplemented("reactivate");

  deactivateAccount: UserApi["deactivateAccount"] = (input) =>
    this.overrides.deactivateAccount?.(input) ?? this.unimplemented("deactivateAccount");

  reactivateAccount: UserApi["reactivateAccount"] = (input) =>
    this.overrides.reactivateAccount?.(input) ?? this.unimplemented("reactivateAccount");

  setAvatar: UserApi["setAvatar"] = (input) =>
    this.overrides.setAvatar?.(input) ?? this.unimplemented("setAvatar");

  setOwnAvatar: UserApi["setOwnAvatar"] = (input) =>
    this.overrides.setOwnAvatar?.(input) ?? this.unimplemented("setOwnAvatar");

  removeAvatar: UserApi["removeAvatar"] = (input) =>
    this.overrides.removeAvatar?.(input) ?? this.unimplemented("removeAvatar");

  ensurePersonalWorkspace: UserApi["ensurePersonalWorkspace"] = (input) =>
    this.overrides.ensurePersonalWorkspace?.(input) ?? this.unimplemented("ensurePersonalWorkspace");

  tryFindPersonalWorkspace: UserApi["tryFindPersonalWorkspace"] = (input) =>
    this.overrides.tryFindPersonalWorkspace?.(input) ?? this.unimplemented("tryFindPersonalWorkspace");

  tryGetLastHomePath: UserApi["tryGetLastHomePath"] = (input) =>
    this.overrides.tryGetLastHomePath?.(input) ?? this.unimplemented("tryGetLastHomePath");

  setLastHomePath: UserApi["setLastHomePath"] = (input) =>
    this.overrides.setLastHomePath?.(input) ?? this.unimplemented("setLastHomePath");

  getPersonalContext: UserApi["getPersonalContext"] = (input) =>
    this.overrides.getPersonalContext?.(input) ?? this.unimplemented("getPersonalContext");

  getPersonalBudget: UserApi["getPersonalBudget"] = (input) =>
    this.overrides.getPersonalBudget?.(input) ?? this.unimplemented("getPersonalBudget");

  requestBudgetIncrease: UserApi["requestBudgetIncrease"] = (input) =>
    this.overrides.requestBudgetIncrease?.(input) ?? this.unimplemented("requestBudgetIncrease");

  getHomePagePickerState: UserApi["getHomePagePickerState"] = (input) =>
    this.overrides.getHomePagePickerState?.(input) ?? this.unimplemented("getHomePagePickerState");

  completeEmailVerification: UserApi["completeEmailVerification"] = (input) =>
    this.overrides.completeEmailVerification?.(input) ?? this.unimplemented("completeEmailVerification");

  getPersonalUsage: UserApi["getPersonalUsage"] = (input) =>
    this.overrides.getPersonalUsage?.(input) ?? this.unimplemented("getPersonalUsage");

  getKeyProject: UserApi["getKeyProject"] = (input) =>
    this.overrides.getKeyProject?.(input) ?? this.unimplemented("getKeyProject");

  countAvatarRead: UserApi["countAvatarRead"] = (input) =>
    this.overrides.countAvatarRead?.(input) ?? this.unimplemented("countAvatarRead");

  readAvatarObject: UserApi["readAvatarObject"] = (input) =>
    this.overrides.readAvatarObject?.(input) ?? this.unimplemented("readAvatarObject");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestUserApi does not implement ${operation}`));
  }

  private refuse(operation: string): never {
    throw new Error(`TestUserApi does not implement ${operation}`);
  }
}
