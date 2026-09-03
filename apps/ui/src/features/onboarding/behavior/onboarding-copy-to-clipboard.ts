/**
 * The success notice only goes out once the clipboard write actually
 * resolved — a refused write would silently claim "copied". The api-key
 * family's shape, second use.
 */

import type {
  OnboardingFailureNotice,
  OnboardingSuccessNotice,
} from "@langwatch/onboarding-web/screens/onboarding";

export async function copyToClipboard({
  text,
  succeeded,
  writeClipboard,
  onSucceeded,
  onFailed,
}: {
  text: string;
  succeeded: OnboardingSuccessNotice;
  writeClipboard: (text: string) => Promise<void>;
  onSucceeded: (notice: OnboardingSuccessNotice) => void;
  onFailed: (failure: OnboardingFailureNotice) => void;
}): Promise<boolean> {
  try {
    await writeClipboard(text);
    onSucceeded(succeeded);
    return true;
  } catch (error) {
    onFailed({
      error,
      fallbackTitle: "Failed to copy",
      description: "Couldn't copy. Please try again.",
    });
    return false;
  }
}
