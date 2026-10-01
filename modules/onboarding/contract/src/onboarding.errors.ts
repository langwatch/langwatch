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
