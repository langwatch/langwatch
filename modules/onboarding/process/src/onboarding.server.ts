import { defineServerModule } from "@langwatch/kernel";

import { OnboardingApp } from "./app/onboarding.app.ts";
import { onboardingTrpcTransport } from "./transport/onboarding.trpc.ts";

export const onboardingServer = defineServerModule("onboarding")
  .withApp(OnboardingApp)
  .withTransports(onboardingTrpcTransport);
