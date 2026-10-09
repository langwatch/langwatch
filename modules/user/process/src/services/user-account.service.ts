import {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
} from "@langwatch/user-contract";

export class UserAccountService {
  private constructor() {}

  static create(): UserAccountService {
    return new UserAccountService();
  }

  personalCallerFor(input: {
    project: { isPersonal: boolean; ownerUserId: string | null };
    callerUserId: string | undefined;
  }): string {
    if (!input.project.isPersonal || !input.project.ownerUserId) {
      throw new PersonalProjectKeyRequiredError();
    }

    if (input.callerUserId && input.callerUserId !== input.project.ownerUserId) {
      throw new PersonalUsageKeyMismatchError();
    }

    return input.project.ownerUserId;
  }
}
