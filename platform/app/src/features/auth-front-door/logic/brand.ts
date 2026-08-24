/**
 * The website's brand values, as these screens use them — and only these
 * screens.
 *
 * The front door is the first LangWatch surface most people see, and it should
 * look like the site they arrived from rather than like an application they
 * have not signed in to yet. The app's Chakra `orange` palette is a different
 * orange; reconciling the two everywhere is a theme change this slice has no
 * business making, so the reconciliation stops here.
 *
 * Every value is a CUSTOM PROPERTY, not a hex. The properties are declared in
 * `authFrontDoor.css` for both colour modes, so the mode toggle moves these
 * surfaces with the rest of the app and nothing here is pinned to a light
 * page. The fallback in each `var()` is the light value, for the one case the
 * stylesheet has not loaded yet.
 */
export const BRAND = {
  /** The primary action: the site's `btn-primary`, an ink pill. The brand
   *  orange is the accent around it, never the button itself. */
  action: "var(--lw-front-door-action, #141417)",
  /** The primary action, hovered. */
  actionHover: "var(--lw-front-door-action-hover, #26261f)",
  /** Text on a tinted surface: readable where the tint alone is not. */
  ink: "var(--lw-front-door-ink, #a83e05)",
  /** The tint itself. */
  tint: "var(--lw-front-door-tint, #fdece0)",
  /** Text that sits on the action colour. */
  onAction: "var(--lw-front-door-on-action, #efeee9)",
  /**
   * Focus rings, badges and hairline accents: the brand without being the
   * button. It steps up a stop on dark, where the solid orange that reads as
   * an action on white disappears into a dark field as a ring.
   */
  detail: "var(--lw-front-door-detail, #f56b1a)",
  /**
   * Refusals. A dark ground needs a lighter red than a white one: the light
   * cut fails contrast there and reads as brown, which is not a colour anybody
   * reads as "wrong".
   */
  danger: "var(--lw-front-door-danger, #c53030)",
} as const;

/**
 * Headings on the site are set in Sentient. The font file is not in this
 * repository, so headings land on the serif fallback until it is: a real serif
 * stack, in the same weight and tracking, which reads as the same decision
 * rather than as a missing one.
 */
export const HEADING_FONT =
  '"Sentient", ui-serif, Georgia, "Times New Roman", serif';

/**
 * The tagline under the headline is set in the mono face, the way the site
 * sets its small technical lines. It is the one place these screens use it.
 */
export const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** The shapes: pills for actions, a soft radius for fields, 14px for the card. */
export const SHAPE = {
  action: "full",
  field: "10px",
  card: "14px",
} as const;
