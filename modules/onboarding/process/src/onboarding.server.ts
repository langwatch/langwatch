import { bindRestMiddleware, projectCredentialOfRequest } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { OnboardingApp } from "./app/onboarding.app.ts";
import { onboardingRest, onboardingRestCredential } from "./transport/onboarding.rest.ts";
import { onboardingTrpcTransport } from "./transport/onboarding.trpc.ts";

export const onboardingServer = defineServerModule("onboarding")
  .withApp(OnboardingApp)
  .withTransports(onboardingTrpcTransport, onboardingRest)
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
