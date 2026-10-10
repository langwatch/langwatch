/**
 * Writes text to the clipboard. The async API exists only in a secure context;
 * a console reached over plain http on a LAN name falls back to a hidden
 * textarea and the legacy copy command.
 */
export const writeClipboardText = async ({ text }: { text: string }): Promise<void> => {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const scratch = document.createElement("textarea");
  scratch.value = text;
  scratch.setAttribute("readonly", "");
  scratch.className = "ds-visually-hidden";
  document.body.append(scratch);
  scratch.select();
  const copied = document.execCommand("copy");
  scratch.remove();
  if (!copied) throw new Error("The browser refused to copy.");
};
