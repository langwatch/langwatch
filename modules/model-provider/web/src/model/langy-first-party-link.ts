/**
 * The marker that tells Langy's link guard an anchor is ours.
 *
 * The Langy panel installs a capture-phase click guard over every link it
 * renders, because those links are written by an agent working on data it was
 * handed. A LangWatch component that renders a genuine first-party link opts
 * out by spelling this attribute — and it is safe as an opt-out precisely
 * because model output can never produce it: the markdown pipeline renders no
 * raw HTML and emits no data attributes on anchors.
 *
 * DECLARED HERE RATHER THAN IMPORTED, and the reason is a cycle rather than
 * taste: the attribute is `@langwatch/langy-web`'s
 * (`use-langy-external-link-guard.ts`), and langy-web already depends on THIS
 * package, so the import would close a loop. It is one string and it is the
 * guard's public contract on both sides; if a third caller needs it, that is
 * the signal to promote it into a package both can import rather than to copy
 * it again.
 */

export const LANGY_FIRST_PARTY_LINK_ATTRIBUTE = "data-langy-first-party-link";

/** Spread onto a first-party anchor: `<Link {...langyFirstPartyLinkProps}>`. */
export const langyFirstPartyLinkProps = {
  [LANGY_FIRST_PARTY_LINK_ATTRIBUTE]: "true",
} as const;
