import { clipboardUnavailableError, toaster } from "@langwatch/browser-host/toaster";

/**
 * Copy + toast pattern; a refusal is a failure with a code, so the host words it.
 * Onboarding-only screens use OnboardingHostApi.copyToClipboard.
 */
export async function copyToClipboard({
  text,
  successMessage,
}: {
  text: string;
  successMessage: string;
}): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toaster.create({
      title: "Copied",
      description: successMessage,
      type: "success",
    });
    return true;
  } catch {
    toaster.create({
      title: "Failed to copy",
      error: clipboardUnavailableError(),
      type: "error",
    });
    return false;
  }
}
