import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { OnboardingModule } from "./app/onboarding.app.ts";
import { guidedOnboardingLifecycleEventing } from "./eventing/guided-onboarding-lifecycle.pipeline.ts";
import { integrationsChecksTrpcTransport } from "./transport/integrations-checks.trpc.ts";
import { onboardingRest, onboardingRestCredential } from "./transport/onboarding.rest.ts";
import { onboardingTrpcTransport } from "./transport/onboarding.trpc.ts";

export const onboardingProcessModule = defineProcessModule("onboarding")
  .withApi(OnboardingModule)
  .withTransports(onboardingTrpcTransport, integrationsChecksTrpcTransport, onboardingRest)
  .withEventing(guidedOnboardingLifecycleEventing)
  .withTransportFacts(() => [
    bindRestMiddleware(onboardingRestCredential, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);
      const organizationId =
        credential.type === "apiKey"
          ? credential.organizationId
          : credential.project.organizationId;
      const userId = credential.type === "apiKey" ? credential.userId : null;

      return { organizationId, userId };
    }),
  ]);
