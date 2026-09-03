/**
 * A clipboard write that only claims success once the write actually
 * landed: a refusal (Safari private mode, a non-secure context) arrives as
 * a rejection, and silently saying "copied" is worse than saying nothing.
 */

import type {
  ApiKeyFailureNotice,
  ApiKeySuccessNotice,
} from "@langwatch/api-key-web/screens/api-key";

export async function copyToClipboard({
  text,
  succeeded,
  writeClipboard,
  onSucceeded,
  onFailed,
}: {
  text: string;
  succeeded: ApiKeySuccessNotice;
  writeClipboard: (text: string) => Promise<void>;
  onSucceeded: (notice: ApiKeySuccessNotice) => void;
  onFailed: (failure: ApiKeyFailureNotice) => void;
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
