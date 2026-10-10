import { toaster } from "@langwatch/design-system/toaster";

/**
 * Copy + toast pattern; uses design system toaster for trace-web compatibility.
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
      description: "Couldn't copy. Please try again.",
      type: "error", // no-raw-error-toast-ok
    });
    return false;
  }
}
