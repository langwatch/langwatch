/**
 * The auth screens's light-mode palette, transcribed for mail.
 *
 * ── Source of truth ─────────────────────────────────────────────────────────
 * `src/features/auth/authTheme.ts` holds these values as Chakra
 * semantic tokens, and `src/components/auth/AuthCard.tsx` holds the shape they
 * are used in. Neither can be imported here: they are browser modules (Chakra,
 * React DOM components), and `src/server/__tests__/frontend-boundary.unit.test.ts`
 * exists to keep that graph out of every backend process. Mail also cannot read
 * a CSS custom property — a client that strips `<style>` keeps the inline
 * declaration and loses the variable behind it — so a token is no use here even
 * if it could be reached.
 *
 * So the values are copied, by hand, once, into this file, and every template
 * reads them from here. `__tests__/emailTheme.unit.test.ts` asserts the two
 * that carry the identity (the action colour and the ground) against the
 * literals in `authTheme.ts`, so a change to the auth screens that never
 * reached the mail is a red test rather than a slow drift.
 *
 * ── Light only ──────────────────────────────────────────────────────────────
 * There is no dark half. A mail client's dark mode is a transform applied to
 * somebody else's HTML — Outlook inverts, Gmail's Android app inverts
 * selectively, Apple Mail leaves an explicitly-coloured element alone — and
 * none of it is addressable from here. Every surface is therefore given an
 * explicit colour on an explicit white ground, which is what an inverting
 * client needs in order to invert the whole thing coherently rather than
 * leaving ink text on a darkened field.
 *
 * ── Alphas composited ───────────────────────────────────────────────────────
 * The auth screens draws its hairlines as ink at an alpha over whatever ground
 * is behind them. Mail grounds are white and only white, so the same lines are
 * written here as the solid colour that alpha resolves to on white. The alpha
 * each one came from is named beside it.
 */

/** The brand ramp, as `authTheme.ts` cuts it. */
const brand = {
  500: "#f56b1a",
  600: "#c2510a",
  700: "#a83e05",
} as const;

/** Ink, and the two steps down from it that mail needs for secondary text. */
const ink = {
  900: "#141417",
  /** ink.900 at 70% over white: the auth screens' `fg.muted` weight. */
  700: "#5b5b5d",
  /** ink.900 at 60% over white: fine print, and nothing louder. */
  500: "#727274",
} as const;

export const EMAIL_COLOR = {
  /** `auth.ground` (light). The paper everything stands on. */
  ground: "#ffffff",
  /** The site's cream paper, under the card: the page the mail stands on
   *  reads as the website's own ground, and the white card as a pane on it. */
  page: "#f6f2ea",
  /** `auth.action` (light): the site's ink pill. The orange stays in the
   *  details — links, tints, accents — never on the button. */
  action: ink[900],
  /** `auth.onAction`. */
  onAction: "#ffffff",
  /** `auth.detail` (light): the brand without being the button. */
  detail: brand[500],
  /** `auth.ink` (light): text on the tint, readable where the tint is not. */
  accentText: brand[700],
  /** `auth.tint` (light). Callouts and quoted blocks. */
  tint: "#fdece0",
  /** `auth.danger` (light). */
  danger: "#c53030",
  /** A green in the same register as the danger red: quiet, not a highlighter. */
  ok: "#2f7a55",
  text: ink[900],
  textMuted: ink[700],
  textSubtle: ink[500],
  /** `auth.cardBorder` (light), rgba(20,20,23,0.09) resolved on white. */
  cardBorder: "#eaeaeb",
  /** `auth.hairline` (light), rgba(20,20,23,0.12) resolved on white. */
  hairline: "#e3e3e4",
  /** `auth.fieldBg` — the quiet fill under a code block or a table head. */
  fieldBg: "#f6f5f4",
} as const;

/**
 * `SHAPE` from `authTheme.ts`, in pixels. The action is a pill there and
 * a pill here; a client that drops the radius gets a rectangle, which is the
 * same button with a corner missing rather than a different one.
 */
export const EMAIL_RADIUS = {
  card: "14px",
  field: "10px",
  action: "999px",
} as const;

/**
 * No web font is loaded. The auth screens serves Sentient for its display voice
 * and the card itself never uses it — "the serif display voice belongs to the
 * value panel beside the card, never to the card itself" — and the card is
 * what mail is modelled on, so there is nothing to load. A remote font in mail
 * is a tracking pixel that sometimes draws letters.
 */
export const EMAIL_FONT = {
  body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** `MONO_FONT` from `authTheme.ts`, with Courier as the last resort. */
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Courier New", monospace',
} as const;

/**
 * The card's type scale, one step up.
 *
 * `AuthCard` sets its heading at 19px and its intro at 13.5px, on a 408px card
 * whose text measure is 344px. A mail card is read at roughly 500px and often
 * at arm's length on a phone, so every size here is the card's size taken up
 * one step, with its weights, tracking and leading kept exactly.
 */
export const EMAIL_TYPE = {
  title: { size: "20px", weight: 600, tracking: "-0.015em", leading: 1.35 },
  section: { size: "15px", weight: 600, tracking: "-0.01em", leading: 1.4 },
  body: { size: "15px", weight: 400, leading: 1.6 },
  small: { size: "13.5px", weight: 400, leading: 1.55 },
  finePrint: { size: "12px", weight: 400, leading: 1.6 },
  action: { size: "14px", weight: 600 },
  /** Table heads and meter labels: the smallest thing that is still a label. */
  label: { size: "12.5px", weight: 500, leading: 1.4 },
} as const;

/** `AuthCard`'s own padding and gaps, unchanged. */
export const EMAIL_SPACE = {
  page: "32px 12px",
  cardTop: "34px",
  cardX: "32px",
  cardBottom: "32px",
  /** Header block to first row. */
  headerToBody: "22px",
  /** The identity block's internal gap. */
  headerGap: "12px",
  /** One row to the next. */
  row: "16px",
  /** One block of the mail to the next. */
  block: "24px",
  /** Everything to the fine print under it. */
  finePrint: "18px",
  /**
   * Where the card's text column starts, measured from the page's own edge:
   * the page's 12px gutter, the card's hairline, and the card's 32px padding.
   * Anything laid out beside the card rather than inside it lines up on this.
   */
  textInset: "45px",
} as const;

/** The card is 408px on the auth screens; mail wants a wider measure. */
export const EMAIL_WIDTH = { card: "560px" } as const;

/**
 * The wordmark, treated the way the auth screens treats it: the mark alone,
 * centred, at the top of the card, at the auth screens' own 112px.
 *
 * It is a raster copy rather than the `FullLogo` component, which reads the
 * colour mode and cannot leave the browser. `logo.png` is 4247×1040, so 112px
 * wide is 27px tall — the same 112×27.5 the card draws.
 */
export const EMAIL_WORDMARK = {
  src: "https://app.langwatch.ai/images/logo.png",
  alt: "LangWatch",
  width: "112",
  height: "27",
} as const;
