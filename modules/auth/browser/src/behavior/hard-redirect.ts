/**
 * Full-page navigation to bust in-memory caches; window.location is non-configurable.
 * Between the assignment and the next document, in-flight reads fail as if the
 * server were unreachable — `isNavigatingAway` lets a screen wait instead.
 */
let navigatingAway = false;

export function isNavigatingAway(): boolean {
  return navigatingAway;
}

export function hardRedirect(url: string): void {
  navigatingAway = true;
  window.location.href = url;
}
