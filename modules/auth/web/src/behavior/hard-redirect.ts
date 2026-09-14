/**
 * Full-page navigation to bust in-memory caches; window.location is non-configurable
 */
export function hardRedirect(url: string): void {
  window.location.href = url;
}
