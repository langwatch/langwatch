/** The success notice only goes out once the clipboard write actually resolved — a refused write would send the reader to a terminal with an empty paste. */
import type { AuthorizeSuccessNotice } from "@langwatch/api-key-web/screens/authorize";

export async function copyProjectApiKeyToClipboard({
  text,
  succeeded,
  writeClipboard,
  onSucceeded,
  onFailed,
}: {
  text: string;
  succeeded: AuthorizeSuccessNotice;
  writeClipboard: (text: string) => Promise<void>;
  onSucceeded: (notice: AuthorizeSuccessNotice) => void;
  onFailed: (failure: { error: unknown; fallbackTitle: string; description: string }) => void;
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
