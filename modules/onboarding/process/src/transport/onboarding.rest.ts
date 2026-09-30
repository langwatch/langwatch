/**
 * `/api/v1/onboarding/guided` — the CLI/agent-facing twin of `onboarding.*`.
 * Langy's own session key is the intended caller; a key bound to no user reads and
 * completes the project's organization state too, as on main.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  guidedPathCompleteRestInputSchema,
  guidedPathRestParamsSchema,
  guidedStateOutputSchema,
  guidedStateWithVariantOutputSchema,
  onboardingRestCredentialSchema,
  OnboardingApi,
} from "@langwatch/onboarding-contract";

export const onboardingRestCredential = defineRestMiddleware(
  "onboardingRestCredential",
  onboardingRestCredentialSchema,
);

export const onboardingRest = defineRestRouter(OnboardingApi)
  .withNamespace("onboarding")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/guided", "getApiOnboardingGuided")
  .withPermission("project:view")
  .withOutput(guidedStateWithVariantOutputSchema)
  .withMiddleware(onboardingRestCredential)
  .withDocs({
    hide: true,
    tags: ["Onboarding"],
    description:
      "Read the guided onboarding state of this project's organization: the paths picked in order, the one being set up, the ones done, the provider connected, and where the tour stands.",
  })
  .handle(async ({ app }, credential) => app.getGuidedState(credential))

  .post("/guided/paths/:path/complete", "postApiOnboardingGuidedPathComplete")
  .withParams(guidedPathRestParamsSchema)
  .withInput(guidedPathCompleteRestInputSchema)
  .withPermission("project:view")
  .withOutput(guidedStateOutputSchema)
  .withMiddleware(onboardingRestCredential)
  .withDocs({
    hide: true,
    tags: ["Onboarding"],
    description:
      "Mark one guided onboarding path as done for this project's organization. Idempotent: completing a path twice changes nothing. An unknown path is refused with guided_onboarding_path_unknown.",
  })
  .handle(async ({ app, input }, credential) =>
    app.completePath({ ...credential, path: input.path }),
  )
  .build();
