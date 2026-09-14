/**
 * The marker that tells Langy's link guard an anchor is ours; safe as an opt-out since the
 * markdown pipeline never emits data attributes on model-authored anchors. Declared here
 * rather than imported from `@langwatch/langy-web` to avoid a dependency cycle (langy-web
 * already depends on this package).
 */

export const LANGY_FIRST_PARTY_LINK_ATTRIBUTE = "data-langy-first-party-link";

/** Spread onto a first-party anchor: `<Link {...langyFirstPartyLinkProps}>`. */
export const langyFirstPartyLinkProps = {
  [LANGY_FIRST_PARTY_LINK_ATTRIBUTE]: "true",
} as const;
