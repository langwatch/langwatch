import { toaster } from "../../../../../components/ui/toaster";

/**
 * Copies text to the clipboard and shows a toast notification.
 *
 * Centralises the clipboard-write + toast pattern used across
 * onboarding screens so that every copy action behaves consistently.
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
      meta: { closable: true },
    });
    return true;
  } catch {
    toaster.create({
      title: "Failed to copy",
      description: "Couldn't copy. Please try again.",
      type: "error",
      meta: { closable: true },
    });
    return false;
  }
}
