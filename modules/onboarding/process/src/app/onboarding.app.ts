import {
  OnboardingApi,
  onboardingConfig,
  type OnboardingApi as OnboardingApiContract,
} from "@langwatch/onboarding-contract";

export class OnboardingApp implements OnboardingApiContract {
  static readonly contract = OnboardingApi;
  static readonly dependencies = {};
  static readonly config = onboardingConfig;

  private constructor() {}

  static create(): OnboardingApp {
    return new OnboardingApp();
  }
}
