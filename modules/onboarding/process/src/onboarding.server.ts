import { defineServerModule } from "@langwatch/kernel";

import { OnboardingApp } from "./app/onboarding.app.ts";

export const onboardingServer = defineServerModule("onboarding").withApp(OnboardingApp).build();
