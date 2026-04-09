/**
 * Generate a UUID v4 string with graceful degradation for non-secure contexts.
 *
 * Fallback chain:
 * 1. crypto.randomUUID() — available in secure contexts (HTTPS / localhost)
 * 2. crypto.getRandomValues() — available in all modern browsers, even over HTTP
 * 3. Math.random() — last resort (SSR, very old environments)
 */
export function generateUUID(): string {
  // Prefer native randomUUID when available (secure contexts)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      // Falls through to getRandomValues fallback
    }
  }

  // Fallback: crypto.getRandomValues (works in all browsers, even over HTTP)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant (10xx) bits per RFC 4122
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
  }

  // Last resort: Math.random (e.g. SSR without crypto)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
