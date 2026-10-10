import type { UserApi } from "@langwatch/user-contract";

/**
 * A complete `UserApi` fake, so a suite stays at the module boundary: the
 * operations a test cares about are overridden and everything else refuses by
 * name.
 */
export class TestUserApi implements UserApi {
  countUsage(): Promise<{ emailDomains: Record<string, number> }> {
    return Promise.resolve({ emailDomains: {} });
  }

  countUsageForMembers: UserApi["countUsageForMembers"] = (input) =>
    this.overrides.countUsageForMembers?.(input) ?? this.unimplemented("countUsageForMembers");

  constructor(private readonly overrides: Partial<UserApi> = {}) {}

  hasAccountOnDomain: UserApi["hasAccountOnDomain"] = (input) =>
    this.overrides.hasAccountOnDomain?.(input) ?? this.unimplemented("hasAccountOnDomain");

  hasAnyAccount: UserApi["hasAnyAccount"] = () =>
    this.overrides.hasAnyAccount?.() ?? this.unimplemented("hasAnyAccount");

  findById: UserApi["findById"] = (input) =>
    this.overrides.findById?.(input) ?? this.unimplemented("findById");

  updateProfile: UserApi["updateProfile"] = (input) =>
    this.overrides.updateProfile?.(input) ?? this.unimplemented("updateProfile");
  updateEmail: UserApi["updateEmail"] = (input) =>
    this.overrides.updateEmail?.(input) ?? this.unimplemented("updateEmail");

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
    this.overrides.getTraceExplorerTourPreference?.(input) ??
    this.unimplemented("getTraceExplorerTourPreference");

  dismissTraceExplorerTour: UserApi["dismissTraceExplorerTour"] = (input) =>
    this.overrides.dismissTraceExplorerTour?.(input) ??
    this.unimplemented("dismissTraceExplorerTour");

  getNotificationPreference: UserApi["getNotificationPreference"] = (input) =>
    this.overrides.getNotificationPreference?.(input) ??
    this.unimplemented("getNotificationPreference");

  setNotificationPreference: UserApi["setNotificationPreference"] = (input) =>
    this.overrides.setNotificationPreference?.(input) ??
    this.unimplemented("setNotificationPreference");

  getLangyCodeAccessPreference: UserApi["getLangyCodeAccessPreference"] = (input) =>
    this.overrides.getLangyCodeAccessPreference?.(input) ??
    this.unimplemented("getLangyCodeAccessPreference");

  setLangyCodeAccessPreference: UserApi["setLangyCodeAccessPreference"] = (input) =>
    this.overrides.setLangyCodeAccessPreference?.(input) ??
    this.unimplemented("setLangyCodeAccessPreference");

  isOperator: UserApi["isOperator"] = (input) =>
    this.overrides.isOperator?.(input) ?? this.unimplemented("isOperator");

  findByEmail: UserApi["findByEmail"] = (input) =>
    this.overrides.findByEmail?.(input) ?? this.unimplemented("findByEmail");

  create: UserApi["create"] = (input) =>
    this.overrides.create?.(input) ?? this.unimplemented("create");

  createPasskeyUser: UserApi["createPasskeyUser"] = (input) =>
    this.overrides.createPasskeyUser?.(input) ?? this.unimplemented("createPasskeyUser");

  registerCredentialAccount: UserApi["registerCredentialAccount"] = (input) =>
    this.overrides.registerCredentialAccount?.(input) ??
    this.unimplemented("registerCredentialAccount");

  hasPassword: UserApi["hasPassword"] = (input) =>
    this.overrides.hasPassword?.(input) ?? this.unimplemented("hasPassword");

  setFirstPassword: UserApi["setFirstPassword"] = (input) =>
    this.overrides.setFirstPassword?.(input) ?? this.unimplemented("setFirstPassword");

  getPasskeyOffer: UserApi["getPasskeyOffer"] = (input) =>
    this.overrides.getPasskeyOffer?.(input) ?? this.unimplemented("getPasskeyOffer");

  dismissPasskeyNudge: UserApi["dismissPasskeyNudge"] = (input) =>
    this.overrides.dismissPasskeyNudge?.(input) ?? this.unimplemented("dismissPasskeyNudge");

  findJoinOfferDismissedDomains: UserApi["findJoinOfferDismissedDomains"] = (input) =>
    this.overrides.findJoinOfferDismissedDomains?.(input) ??
    this.unimplemented("findJoinOfferDismissedDomains");

  dismissJoinOffer: UserApi["dismissJoinOffer"] = (input) =>
    this.overrides.dismissJoinOffer?.(input) ?? this.unimplemented("dismissJoinOffer");

  rotatePassword: UserApi["rotatePassword"] = (input) =>
    this.overrides.rotatePassword?.(input) ?? this.unimplemented("rotatePassword");

  findAuth0DatabaseAccount: UserApi["findAuth0DatabaseAccount"] = (input) =>
    this.overrides.findAuth0DatabaseAccount?.(input) ??
    this.unimplemented("findAuth0DatabaseAccount");

  listLinkedAccounts: UserApi["listLinkedAccounts"] = (input) =>
    this.overrides.listLinkedAccounts?.(input) ?? this.unimplemented("listLinkedAccounts");

  unlinkAccount: UserApi["unlinkAccount"] = (input) =>
    this.overrides.unlinkAccount?.(input) ?? this.unimplemented("unlinkAccount");

  unlinkOwnAccount: UserApi["unlinkOwnAccount"] = (input) =>
    this.overrides.unlinkOwnAccount?.(input) ?? this.unimplemented("unlinkOwnAccount");

  adoptUnconfirmedAccount: UserApi["adoptUnconfirmedAccount"] = (input) =>
    this.overrides.adoptUnconfirmedAccount?.(input) ??
    this.unimplemented("adoptUnconfirmedAccount");

  deactivate: UserApi["deactivate"] = (input) =>
    this.overrides.deactivate?.(input) ?? this.unimplemented("deactivate");

  reactivate: UserApi["reactivate"] = (input) =>
    this.overrides.reactivate?.(input) ?? this.unimplemented("reactivate");

  recordDeactivated: UserApi["recordDeactivated"] = (input) =>
    this.overrides.recordDeactivated?.(input) ?? this.unimplemented("recordDeactivated");

  reactivateAccount: UserApi["reactivateAccount"] = (input) =>
    this.overrides.reactivateAccount?.(input) ?? this.unimplemented("reactivateAccount");

  setAvatar: UserApi["setAvatar"] = (input) =>
    this.overrides.setAvatar?.(input) ?? this.unimplemented("setAvatar");

  setOwnAvatar: UserApi["setOwnAvatar"] = (input) =>
    this.overrides.setOwnAvatar?.(input) ?? this.unimplemented("setOwnAvatar");

  removeAvatar: UserApi["removeAvatar"] = (input) =>
    this.overrides.removeAvatar?.(input) ?? this.unimplemented("removeAvatar");
  getAvatarUrl: UserApi["getAvatarUrl"] = (input) =>
    this.overrides.getAvatarUrl?.(input) ?? this.unimplemented("getAvatarUrl");

  findLastHomePath: UserApi["findLastHomePath"] = (input) =>
    this.overrides.findLastHomePath?.(input) ?? this.unimplemented("findLastHomePath");

  setLastHomePath: UserApi["setLastHomePath"] = (input) =>
    this.overrides.setLastHomePath?.(input) ?? this.unimplemented("setLastHomePath");

  requestBudgetIncrease: UserApi["requestBudgetIncrease"] = (input) =>
    this.overrides.requestBudgetIncrease?.(input) ?? this.unimplemented("requestBudgetIncrease");

  getHomePagePickerState: UserApi["getHomePagePickerState"] = (input) =>
    this.overrides.getHomePagePickerState?.(input) ?? this.unimplemented("getHomePagePickerState");

  getKeyProject: UserApi["getKeyProject"] = (input) =>
    this.overrides.getKeyProject?.(input) ?? this.unimplemented("getKeyProject");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestUserApi does not implement ${operation}`));
  }

  private refuse(operation: string): never {
    throw new Error(`TestUserApi does not implement ${operation}`);
  }
}
