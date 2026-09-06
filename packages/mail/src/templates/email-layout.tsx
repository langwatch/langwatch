import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";

/**
 * The one shell every LangWatch message is built in.
 *
 * ── Expressive, not productive ─────────────────────────────────────────────
 * The pair of names is IBM Carbon's, which splits its own system the same way
 * and for the same reason: productive styles serve someone getting work done,
 * expressive styles serve a moment that has to carry the brand. We use them for
 * two whole systems rather than two type ramps inside one, which is the only
 * place we depart from Carbon's usage.
 *
 * EXPRESSIVE is the marketing site's: the cream page, the serif
 * display line, the ink pill, the brand orange kept for details — the language
 * of the website and of the front door somebody arrives through. PRODUCTIVE is
 * the application's own: the working surface a person spends the day inside,
 * with its own denser scale and its own orange ramp.
 *
 * Mail is expressive. Every message here is read outside the product, mostly
 * by somebody who is not signed in, and the link in it lands on the front door.
 * A message dressed in the productive system would look like a screenshot of an
 * application the reader has not opened yet.
 *
 * The palette below is therefore the MARKETING site's. The light cut is
 * `emailTheme.ts` from the front-door work, verbatim — the site's cream page,
 * a paper card on it, and an ink pill for the primary action. The brand orange
 * is spent on details and never on the button: an orange slab makes the most
 * important control on the screen the loudest thing the brand owns, and white
 * on that orange never cleared the contrast it pretended to.
 *
 * The application's own `#ED8926` is a DIFFERENT orange, and it is deliberately
 * not here. Somebody who clicks a link in one of these mails lands on the sign-
 * in screen; the two have to look like one company.
 *
 * The dark cut is the front door's dark tokens with the alpha layers composited
 * once — an email has no backdrop to show through, and half the clients that
 * compose a dark ground render no `rgba()` at all.
 */

const light = {
  page: "#f6f2ea",
  card: "#ffffff",
  cardBorder: "#eaeaeb",
  hairline: "#e3e3e4",
  text: "#141417",
  textMuted: "#5b5b5d",
  textSubtle: "#727274",
  action: "#141417",
  onAction: "#ffffff",
  detail: "#f56b1a",
  accentText: "#a83e05",
  tint: "#fdece0",
  field: "#f6f5f4",
} as const;

const dark = {
  page: "#0a0a0c",
  card: "#131316",
  cardBorder: "#26262a",
  hairline: "#26262a",
  text: "#f5f4f1",
  textMuted: "#a3a29e",
  textSubtle: "#8a8985",
  action: "#f5f4f1",
  onAction: "#0a0a0c",
  detail: "#ff8a3d",
  accentText: "#ff8a3d",
  tint: "#3c2317",
  field: "#1c1c20",
} as const;

/**
 * Headings are set in the site's serif; the fallback is the point.
 *
 * The site's display face is Sentient and it is NOT fetched here. A remote font
 * in mail is a tracking pixel that sometimes draws letters, it leaks an open
 * back to us from a person who only read a password reset, and the clients that
 * would most benefit render no woff2 anyway. So the stack names Sentient for
 * anyone who already has it and lands everywhere else on a real serif at the
 * same size and tracking — which reads as the same decision rather than as a
 * missing one, and is why the fallback is a serif stack and not the body sans.
 */
const HEADING_FONT = '"Sentient", ui-serif, Georgia, "Times New Roman", serif';
const BODY_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Courier New", monospace';

/** The expressive system, as mail cuts it. */
export const expressive = { light, dark, HEADING_FONT, BODY_FONT, MONO_FONT } as const;

const SPACE = { finePrint: 18, row: 16, block: 24, header: 22, cardTop: 34, cardX: 32 } as const;
const RADIUS = { card: "14px", field: "10px", action: "999px" } as const;

/**
 * The wordmark, per ground.
 *
 * Light is the raster, because it is the one wordmark that draws in every
 * client including the ones that drop SVG outright. Dark is the SVG cut, which
 * only reaches clients that honour a `prefers-color-scheme` block — the same
 * clients that render SVG. A dark raster is the one asset this would still
 * benefit from.
 */
const WORDMARK_LIGHT = "https://app.langwatch.ai/images/logo.png";
const WORDMARK_DARK = "https://app.langwatch.ai/images/logo-full-darktheme.svg";

const STYLESHEET = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
.lw-dark-only { display: none; mso-hide: all; }
@media (prefers-color-scheme: dark) {
  .lw-body { background-color: ${dark.page} !important; }
  .lw-card { background-color: ${dark.card} !important; border-color: ${dark.cardBorder} !important; }
  .lw-text { color: ${dark.text} !important; }
  .lw-muted { color: ${dark.textMuted} !important; }
  .lw-subtle { color: ${dark.textSubtle} !important; }
  .lw-rule { border-color: ${dark.hairline} !important; }
  .lw-link { color: ${dark.text} !important; }
  .lw-action { background-color: ${dark.action} !important; border-color: ${dark.action} !important; color: ${dark.onAction} !important; }
  .lw-panel { background-color: ${dark.tint} !important; }
  .lw-panel-ink { color: ${dark.accentText} !important; }
  .lw-code { background-color: ${dark.field} !important; color: ${dark.text} !important; }
  .lw-light-only { display: none !important; mso-hide: all; }
  .lw-dark-only { display: block !important; }
}
@media (max-width: 600px) {
  .lw-card { padding: 26px 20px !important; }
}
`;

export const EmailLayout = ({
  preview,
  heading,
  children,
  footNote,
}: {
  /** The line shown beside the subject. Say the outcome, not the product. */
  preview: string;
  heading: string;
  children: ReactNode;
  /** One sentence under the rule saying why this arrived. */
  footNote?: ReactNode;
}) => (
  <Html lang="en" dir="ltr">
    <Head>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      <style>{STYLESHEET}</style>
    </Head>
    <Preview>{preview}</Preview>
    <Body
      className="lw-body"
      style={{
        margin: 0,
        padding: "32px 12px",
        backgroundColor: light.page,
        fontFamily: BODY_FONT,
      }}
    >
      <Container
        className="lw-card"
        style={{
          maxWidth: "560px",
          margin: "0 auto",
          padding: `${SPACE.cardTop}px ${SPACE.cardX}px ${SPACE.cardX}px`,
          backgroundColor: light.card,
          border: `1px solid ${light.cardBorder}`,
          borderRadius: RADIUS.card,
        }}
      >
        <Section style={{ marginBottom: `${SPACE.header}px` }}>
          <Wordmark src={WORDMARK_LIGHT} className="lw-light-only" colour={light.text} />
          <Wordmark src={WORDMARK_DARK} className="lw-dark-only" colour={dark.text} />
        </Section>
        <Heading
          as="h1"
          className="lw-text"
          style={{
            margin: `0 0 ${SPACE.row}px`,
            fontFamily: HEADING_FONT,
            fontSize: "24px",
            fontWeight: 400,
            lineHeight: 1.3,
            letterSpacing: "-0.015em",
            color: light.text,
          }}
        >
          {heading}
        </Heading>
        {children}
        <Hr
          className="lw-rule"
          style={{
            margin: `${SPACE.block}px 0 ${SPACE.finePrint}px`,
            border: "none",
            borderTop: `1px solid ${light.hairline}`,
          }}
        />
        {footNote && <FinePrint>{footNote}</FinePrint>}
        <FinePrint>
          LangWatch ·{" "}
          <Link className="lw-link" href="https://docs.langwatch.ai" style={linkStyle}>
            Documentation
          </Link>{" "}
          ·{" "}
          <Link className="lw-link" href="mailto:support@langwatch.ai" style={linkStyle}>
            support@langwatch.ai
          </Link>
        </FinePrint>
      </Container>
    </Body>
  </Html>
);

/**
 * The wordmark, with the brand name as its own fallback.
 *
 * The `alt` is styled for the clients that block images by default: where the
 * mark does not draw, the word "LangWatch" arrives in the site's serif at the
 * same size, which is the wordmark set in type rather than a broken-image box.
 */
const Wordmark = ({
  src,
  className,
  colour,
}: {
  src: string;
  className: string;
  colour: string;
}) => (
  <Img
    src={src}
    alt="LangWatch"
    width="112"
    height="27"
    className={className}
    style={{
      display: "block",
      border: "none",
      fontFamily: HEADING_FONT,
      fontSize: "20px",
      color: colour,
      textDecoration: "none",
    }}
  />
);

/** Links are ink and underlined, the way the site sets them. */
const linkStyle: CSSProperties = {
  color: light.text,
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

export const Paragraph = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <Text
    className="lw-text"
    style={{
      margin: `0 0 ${SPACE.row}px`,
      fontSize: "15px",
      lineHeight: 1.6,
      color: light.text,
      ...style,
    }}
  >
    {children}
  </Text>
);

/** A softer line — context rather than the message itself. */
export const Muted = ({ children }: { children: ReactNode }) => (
  <Text
    className="lw-muted"
    style={{
      margin: `0 0 ${SPACE.row}px`,
      fontSize: "13.5px",
      lineHeight: 1.55,
      color: light.textMuted,
    }}
  >
    {children}
  </Text>
);

/** The smallest register: why this arrived, and what to ignore. */
export const FinePrint = ({ children }: { children: ReactNode }) => (
  <Text
    className="lw-subtle"
    style={{ margin: "0 0 6px", fontSize: "12px", lineHeight: 1.6, color: light.textSubtle }}
  >
    {children}
  </Text>
);

export const InlineLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link className="lw-link" href={href} style={linkStyle}>
    {children}
  </Link>
);

/** The primary action, in the site's button language: an ink pill on paper. */
export const PrimaryButton = ({ href, children }: { href: string; children: ReactNode }) => (
  <Section style={{ margin: `${SPACE.block}px 0` }}>
    <Button
      className="lw-action"
      href={href}
      style={{
        display: "inline-block",
        padding: "12px 24px",
        lineHeight: "20px",
        backgroundColor: light.action,
        border: `1px solid ${light.action}`,
        color: light.onAction,
        fontSize: "14px",
        fontWeight: 600,
        textDecoration: "none",
        borderRadius: RADIUS.action,
      }}
    >
      {children}
    </Button>
  </Section>
);

/** A tinted aside — the one place the brand orange carries a whole surface. */
export const TintPanel = ({ children }: { children: ReactNode }) => (
  <Section
    className="lw-panel"
    style={{
      margin: `${SPACE.row}px 0`,
      padding: `${SPACE.row}px`,
      backgroundColor: light.tint,
      borderRadius: RADIUS.field,
    }}
  >
    {children}
  </Section>
);

/** Text inside a tint panel, in the accent's readable cut. */
export const TintText = ({ children }: { children: ReactNode }) => (
  <Text
    className="lw-panel-ink"
    style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.55, color: light.accentText }}
  >
    {children}
  </Text>
);

/** Label and value pairs, the shape most of these messages need. */
export const DetailTable = ({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) => (
  <table style={{ width: "100%", borderCollapse: "collapse", margin: `${SPACE.row}px 0` }}>
    <tbody>
      {rows.map((row) => (
        <tr key={row.label}>
          <td
            className="lw-muted"
            style={{
              padding: "7px 16px 7px 0",
              fontSize: "12.5px",
              fontWeight: 500,
              color: light.textMuted,
              whiteSpace: "nowrap",
              verticalAlign: "top",
            }}
          >
            {row.label}
          </td>
          <td
            className="lw-text"
            style={{ padding: "7px 0", fontSize: "13.5px", color: light.text, textAlign: "right" }}
          >
            {row.value}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** A key, a licence, a token: something to be copied exactly. */
export const CodeBlock = ({ children }: { children: ReactNode }) => (
  <pre
    className="lw-code"
    style={{
      margin: `12px 0 ${SPACE.row}px`,
      padding: "12px",
      backgroundColor: light.field,
      borderRadius: RADIUS.field,
      fontFamily: MONO_FONT,
      fontSize: "12px",
      lineHeight: 1.5,
      color: light.text,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "break-all",
    }}
  >
    {children}
  </pre>
);
