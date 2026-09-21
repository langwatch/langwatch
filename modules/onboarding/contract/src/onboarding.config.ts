import { Config, type ConfigOf } from "@langwatch/config";

export const onboardingConfig = Config.define(() => ({}));

export type OnboardingServerConfig = ConfigOf<typeof onboardingConfig>;
