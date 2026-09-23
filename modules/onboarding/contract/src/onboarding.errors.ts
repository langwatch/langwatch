/**
 * Handled errors of the guided onboarding (ADR-045): the failures a caller
 * can act on. A path name outside the four the product knows is the one the
 * CLI can produce, since it takes the path as free text.
 */
import { HandledError } from "@langwatch/handled-error";

import { GUIDED_PATHS } from "./onboarding-guided-paths.ts";

export class GuidedOnboardingPathUnknownError extends HandledError {
  declare readonly code: "guided_onboarding_path_unknown";

  constructor(path: string) {
    super("guided_onboarding_path_unknown", `Unknown onboarding path: ${path}`, {
      httpStatus: 422,
      fault: "customer",
      meta: { path, knownPaths: [...GUIDED_PATHS] },
    });
    this.name = "GuidedOnboardingPathUnknownError";
  }
}

/** Guided state is read and written per person; a key bound to nobody cannot act as one. */
export class OnboardingKeyUserRequiredError extends HandledError {
  declare readonly code: "permission_denied";

  constructor() {
    super(
      "permission_denied",
      "This API key is not tied to a user, so it cannot read or act on guided onboarding state",
      {
        httpStatus: 403,
        fault: "customer",
      },
    );
    this.name = "OnboardingKeyUserRequiredError";
  }
}
