/**
 * Copy text to the clipboard with graceful degradation for non-secure contexts.
 *
 * Fallback chain:
 * 1. navigator.clipboard.writeText() — available in secure contexts (HTTPS / localhost)
 * 2. document.execCommand("copy") via temporary textarea — works over HTTP
 *
 * @returns true if the copy succeeded, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Prefer modern Clipboard API when available
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Falls through to execCommand fallback
    }
  }

  // Fallback: legacy execCommand("copy") via temporary textarea
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      // Move off-screen to avoid visual flash
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  return false;
}
