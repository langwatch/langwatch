/**
 * The success notice only goes out once the write has actually resolved.
 *
 * A clipboard write can be refused — Safari private mode, a non-secure context
 * — and the refusal arrives as a rejection rather than as a return value.
 * Telling the reader "copied" for a write that did not happen is worse than
 * saying nothing, because the failure only shows up when they paste a
 * credential that does not work. The api-key family's shape, second use.
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
