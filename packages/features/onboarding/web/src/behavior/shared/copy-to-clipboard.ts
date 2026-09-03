import { toaster } from "@langwatch/design-system/toaster";

/**
 * Copies text to the clipboard and shows a toast notification.
 *
 * Centralises the clipboard-write + toast pattern used across
 * onboarding screens so that every copy action behaves consistently.
 *
 * STAYS ON THE DESIGN SYSTEM TOASTER, unlike every other failure in this
 * package. Two of its callers — `InlineCopyButton` and `CodePreview` — are
 * imported by `@langwatch/trace-web`'s API-key card, which mounts no onboarding
 * host and cannot: a shared affordance that demanded one would fail to render
 * in the family that borrowed it. A clipboard refusal is also the one failure
 * that can afford to: it has no code, never crosses a wire, and the sentence
 * below is the whole of what a reader can act on, so nothing the presentation
 * registry knows is being given up. The screens that ARE onboarding-only ask
 * `OnboardingHostPort.copyToClipboard` instead, which is the same thing with a
 * host behind it.
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
