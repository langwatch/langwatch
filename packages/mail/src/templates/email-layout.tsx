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
import { tokenize, type HighlightLanguage } from "./onboarding/highlight";

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
  /**
   * Syntax colours, anchored on the expressive palette where it has an answer.
   *
   * The brand orange carries keywords, because a keyword is exactly the kind of
   * detail the orange is kept for; a comment is the palette's quietest text.
   * The green and the blue are the two the palette does not hold and a reader
   * of code expects, chosen to sit at the same weight as the orange rather than
   * to shout past it.
   */
  syntax: {
    keyword: "#a83e05",
    string: "#0a6b46",
    comment: "#8a8985",
    call: "#0a4fa3",
    number: "#0a6b46",
  },
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
  syntax: {
    keyword: "#ff8a3d",
    string: "#7ee7b0",
    comment: "#8a8985",
    call: "#79c0ff",
    number: "#7ee7b0",
  },
} as const;

/**
 * Headings are set in the site's display serif, and in Georgia where they
 * cannot be.
 *
 * Sentient is fetched from Fontshare, who serve it, rather than from an asset
 * of ours: mail has no origin of its own to serve a font from, and Fontshare's
 * own delivery is the path the face is published through. The clients that
 * honour a remote stylesheet — Apple Mail, iOS Mail, Outlook for Mac,
 * Thunderbird — draw the face the front door draws. Gmail on the web and
 * Outlook on Windows strip it and land on the serif stack, which is why the
 * fallback is a serif at the same size and tracking rather than the body sans:
 * both cuts have to read as the same decision.
 *
 * Weight stays 400 and tracking -0.03em in both, because that pair is the
 * front door's display line and a heavier cut of Sentient is a different
 * voice.
 */
/**
 * Where the fine print sends a reader who wants to know more.
 *
 * One constant, used once, in the shell every message is built in: the link
 * belongs to every message equally, so a template that wanted its own copy of
 * it would be the first step toward fifteen slightly different addresses.
 */
export const DOCUMENTATION_URL = "https://docs.langwatch.ai";

const HEADING_FONT = '"Sentient", ui-serif, Georgia, "Times New Roman", serif';
const BODY_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/**
 * The small technical voice: labels, keys, and the eyebrow over a heading.
 * JetBrains Mono is named for anyone who has it and nothing is fetched for
 * anyone who does not: the ruling above covers every face, not only the serif.
 */
const MONO_FONT =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Courier New", monospace';

/** The expressive system, as mail cuts it. */
export const expressive = { light, dark, HEADING_FONT, BODY_FONT, MONO_FONT } as const;

const SPACE = { finePrint: 18, row: 16, block: 26, header: 24, cardTop: 34, cardX: 32 } as const;
const RADIUS = { card: "14px", field: "10px", action: "999px" } as const;

/**
 * The one expressive flourish: the site's mesh, cut to a band.
 *
 * What survives from a shader over a whole viewport is the colour order, as a
 * static strip under the wordmark. The gradient sits over a solid colour, so a
 * client that drops gradients gets a quiet warm rule rather than a gap.
 */
const MESH = {
  light: {
    image: "linear-gradient(90deg, #ffffff 0%, #ffaf6e 32%, #cddcf9 70%, #ffffff 100%)",
    solid: "#ffcfa8",
  },
  dark: {
    image: `linear-gradient(90deg, ${dark.card} 0%, #7a4520 32%, #2f3a55 70%, ${dark.card} 100%)`,
    solid: "#4a3020",
  },
} as const;

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

/**
 * Hiding one of a pair of assets, against an inline `display: block`.
 *
 * `Img` writes an inline `display: block` that outranks a class rule without
 * `!important`, so the wrong wordmark drew through. Everything that could still
 * reserve space or draw the `alt` goes with it, and the shown cut restores each.
 */
const HIDDEN_ASSET = `display: none !important; mso-hide: all; width: 0 !important; max-height: 0 !important; overflow: hidden !important; font-size: 0 !important; line-height: 0 !important;`;
const SHOWN_ASSET = `display: block !important; width: 112px !important; max-height: none !important; overflow: visible !important; font-size: 20px !important; line-height: normal !important;`;

/**
 * The face, from the people who publish it.
 *
 * Both the stylesheet link and an `@font-face` of the same files: a client that
 * drops `<link>` but keeps a `<style>` block still gets the font, and a client
 * that drops both falls through to the stack with nothing to clean up. `swap`
 * so a heading is never invisible while the file arrives.
 */
const SENTIENT_STYLESHEET = "https://api.fontshare.com/v2/css?f[]=sentient@400&display=swap";
const SENTIENT_FILES =
  "https://cdn.fontshare.com/wf/RVTZPYAA57KV4AMXRX7ZIPJXSTYCRP7A/36OUS5CBIXRKI2QU7G7OUHOK7HHA53Y2/SIH66VPT4WS2HIF5PEJNDU4INNUF54LG";

const STYLESHEET = `
@font-face {
  font-family: 'Sentient';
  src: url('${SENTIENT_FILES}.woff2') format('woff2'),
       url('${SENTIENT_FILES}.woff') format('woff');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
:root { color-scheme: light dark; supported-color-schemes: light dark; }
.lw-dark-only { ${HIDDEN_ASSET} }
@media (prefers-color-scheme: dark) {
  .lw-body { background-color: ${dark.page} !important; }
  .lw-page { background-color: ${dark.page} !important; }
  .lw-card { background-color: ${dark.card} !important; border-color: ${dark.cardBorder} !important; }
  .lw-text { color: ${dark.text} !important; }
  .lw-muted { color: ${dark.textMuted} !important; }
  .lw-subtle { color: ${dark.textSubtle} !important; }
  .lw-rule { border-color: ${dark.hairline} !important; }
  .lw-link { color: ${dark.accentText} !important; }
  .lw-eyebrow { color: ${dark.accentText} !important; }
  .lw-mesh { background-color: ${MESH.dark.solid} !important; background-image: ${MESH.dark.image} !important; }
  .lw-action { background-color: ${dark.action} !important; border-color: ${dark.action} !important; color: ${dark.onAction} !important; }
  .lw-action-secondary { background-color: ${dark.card} !important; border-color: ${dark.cardBorder} !important; color: ${dark.text} !important; }
  .lw-panel { background-color: ${dark.tint} !important; }
  .lw-panel-ink { color: ${dark.accentText} !important; }
  .lw-code { background-color: ${dark.field} !important; color: ${dark.text} !important; }
  .lw-table-head { color: ${dark.textMuted} !important; border-color: ${dark.hairline} !important; }
  .lw-table-cell { color: ${dark.text} !important; border-color: ${dark.hairline} !important; }
  .lw-table-secondary { color: ${dark.textMuted} !important; }
  .lw-tok-keyword { color: ${dark.syntax.keyword} !important; }
  .lw-tok-string { color: ${dark.syntax.string} !important; }
  .lw-tok-comment { color: ${dark.syntax.comment} !important; }
  .lw-tok-call { color: ${dark.syntax.call} !important; }
  .lw-tok-number { color: ${dark.syntax.number} !important; }
  .lw-light-only { ${HIDDEN_ASSET} }
  .lw-dark-only { ${SHOWN_ASSET} }
}
@media (max-width: 600px) {
  .lw-card { padding: 26px 20px !important; }
}
`;

export const EmailLayout = ({
  preview,
  eyebrow,
  heading,
  children,
  footNote,
}: {
  /** The line shown beside the subject. Say the outcome, not the product. */
  preview: string;
  /** One or two words naming what this is about, over the heading. */
  eyebrow?: string;
  heading: string;
  children: ReactNode;
  /** One sentence under the rule saying why this arrived. */
  footNote?: ReactNode;
}) => (
  <Html lang="en" dir="ltr">
    <Head>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      <link rel="stylesheet" href={SENTIENT_STYLESHEET} />
      <style>{STYLESHEET}</style>
    </Head>
    <Preview>{preview}</Preview>
    <Body className="lw-body" style={{ margin: 0, padding: 0, backgroundColor: light.page }}>
      {/*
        `Body` copies its style onto an inner cell but keeps the class name on
        `<body>`, so the cell that draws the frame around the card had no class
        for the dark rule to reach and the page stayed cream around a dark card.
        This cell carries the class, and paints the ground.
      */}
      <Section
        className="lw-page"
        style={{ padding: "32px 12px", backgroundColor: light.page, fontFamily: BODY_FONT }}
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
          <Section style={{ marginBottom: "14px" }}>
            <Wordmark src={WORDMARK_LIGHT} className="lw-light-only" colour={light.text} />
            <Wordmark src={WORDMARK_DARK} className="lw-dark-only" colour={dark.text} hidden />
          </Section>
          <MeshBand />
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <Heading
            as="h1"
            className="lw-text"
            style={{
              margin: `0 0 ${SPACE.row}px`,
              fontFamily: HEADING_FONT,
              fontSize: "29px",
              fontWeight: 400,
              lineHeight: 1.2,
              letterSpacing: "-0.03em",
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
            <span style={{ fontFamily: MONO_FONT, fontSize: "11px", letterSpacing: "0.08em" }}>
              LANGWATCH
            </span>{" "}
            ·{" "}
            <Link className="lw-link" href={DOCUMENTATION_URL} style={linkStyle}>
              Documentation
            </Link>{" "}
            ·{" "}
            <Link className="lw-link" href="mailto:support@langwatch.ai" style={linkStyle}>
              support@langwatch.ai
            </Link>
          </FinePrint>
        </Container>
      </Section>
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
  hidden = false,
}: {
  src: string;
  className: string;
  colour: string;
  /** The cut for the other ground: hidden inline as well as by class. */
  hidden?: boolean;
}) => (
  <Img
    src={src}
    alt="LangWatch"
    width="112"
    height="27"
    className={className}
    style={{
      display: hidden ? "none" : "block",
      border: "none",
      fontFamily: HEADING_FONT,
      fontSize: "20px",
      color: colour,
      textDecoration: "none",
    }}
  />
);

/**
 * The mesh band, as a table cell with a solid colour behind the gradient.
 *
 * Outlook draws no percentage-width `div`, so this is a one-cell table. The
 * height is the cell's own `height`, `line-height` and zero font size rather
 * than anything inside it, which is the only way a 3 pixel row stays 3 pixels.
 */
const MeshBand = () => (
  <table
    width="100%"
    border={0}
    cellPadding="0"
    cellSpacing="0"
    role="presentation"
    style={{ width: "100%", borderCollapse: "collapse", margin: `0 0 ${SPACE.header}px` }}
  >
    <tbody>
      <tr>
        <td
          className="lw-mesh"
          height="3"
          style={{
            height: "3px",
            lineHeight: "3px",
            fontSize: 0,
            backgroundColor: MESH.light.solid,
            backgroundImage: MESH.light.image,
            borderRadius: "2px",
          }}
        >
          &nbsp;
        </td>
      </tr>
    </tbody>
  </table>
);

/** The short mono line over a heading, naming what the message is about. */
export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <Text
    className="lw-eyebrow"
    style={{
      margin: "0 0 8px",
      fontFamily: MONO_FONT,
      fontSize: "11px",
      fontWeight: 500,
      lineHeight: 1.4,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: light.detail,
    }}
  >
    {children}
  </Text>
);

/** Links carry the brand colour, in the cut that survives on paper. */
const linkStyle: CSSProperties = {
  color: light.accentText,
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

const ACTION_STYLE: CSSProperties = {
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
};

const SECONDARY_ACTION_STYLE: CSSProperties = {
  ...ACTION_STYLE,
  backgroundColor: light.card,
  border: `1px solid ${light.cardBorder}`,
  color: light.text,
};

/** The primary action, in the site's button language: an ink pill on paper. */
export const PrimaryButton = ({ href, children }: { href: string; children: ReactNode }) => (
  <Section style={{ margin: `${SPACE.block}px 0` }}>
    <Button className="lw-action" href={href} style={ACTION_STYLE}>
      {children}
    </Button>
  </Section>
);

/**
 * The actions of a message, on one line, with the supporting note under them.
 *
 * Two buttons stacked as separate blocks read as two unrelated things that
 * happen to follow one another, and the line explaining the second ends up
 * further from it than the first button is. Side by side in one row they read
 * as what they are: the thing to do, and the other thing available. Outlook
 * draws no flexbox, so the row is two cells and the second is only drawn when
 * there is a second action.
 */
export const ActionRow = ({
  primary,
  secondary,
  note,
}: {
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
  /** One line under the row, explaining the secondary action. */
  note?: ReactNode;
}) => (
  <Section style={{ margin: `${SPACE.block}px 0 ${SPACE.row}px` }}>
    <table
      border={0}
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{ borderCollapse: "separate", borderSpacing: "0" }}
    >
      <tbody>
        <tr>
          <td style={{ paddingRight: secondary ? "10px" : "0", verticalAlign: "middle" }}>
            <Button className="lw-action" href={primary.href} style={ACTION_STYLE}>
              {primary.label}
            </Button>
          </td>
          {secondary && (
            <td style={{ verticalAlign: "middle" }}>
              <Button
                className="lw-action-secondary"
                href={secondary.href}
                style={SECONDARY_ACTION_STYLE}
              >
                {secondary.label}
              </Button>
            </td>
          )}
        </tr>
      </tbody>
    </table>
    {note && (
      <Text
        className="lw-subtle"
        style={{ margin: "10px 0 0", fontSize: "12.5px", lineHeight: 1.5, color: light.textSubtle }}
      >
        {note}
      </Text>
    )}
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
              padding: "8px 16px 8px 0",
              fontFamily: MONO_FONT,
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
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

/**
 * One column of a data table.
 *
 * `align` is the whole of the numeric treatment a mail can carry: tabular
 * figures are asked for and the client either has them or does not, but a
 * right edge lines up in every client there is, and a column of counts that
 * does not line up is the difference between a table and a list.
 */
export interface DataColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  /** A share of the mail column, when equal shares are the wrong shares. */
  width?: string;
  /** A second, quieter value under the first, where the row carries one. */
  secondary?: boolean;
}

/** One row: a stable key, its cells by column key, and an optional link on the first. */
export interface DataRow {
  key: string;
  cells: Readonly<Record<string, ReactNode>>;
  /** Where the first column's cell points, when it points anywhere. */
  href?: string;
}

/**
 * The one table every message shows data in.
 *
 * Written once because the alternative already happened: a usage breakdown
 * with its own header styles, a seat position written as prose, a digest of
 * bare links. Each read as a different product. It is a real `<table>` with
 * inline styles rather than anything flexible, because Outlook draws no
 * percentage-width `div` and a data view that collapses is worse than none.
 *
 * A column every shown row leaves empty is dropped rather than drawn as a
 * stripe of nothing: a digest whose rows carry only an identifier is exactly
 * as informative as it was before the other columns existed.
 */
export const DataTable = ({
  columns,
  rows,
}: {
  columns: readonly DataColumn[];
  rows: readonly DataRow[];
}) => {
  const shown = columns.filter((column) =>
    rows.some((row) => {
      const cell = row.cells[column.key];

      return cell !== undefined && cell !== null && cell !== "";
    }),
  );
  if (shown.length === 0 || rows.length === 0) return null;

  return (
    <table
      className="lw-table"
      width="100%"
      border={0}
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{
        width: "100%",
        borderCollapse: "collapse",
        margin: `${SPACE.row}px 0`,
        tableLayout: "fixed",
      }}
    >
      <thead>
        <tr>
          {shown.map((column) => (
            <th
              key={column.key}
              className="lw-table-head"
              style={{
                width: column.width,
                padding: "0 12px 7px 0",
                textAlign: column.align ?? "left",
                fontFamily: MONO_FONT,
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: light.textMuted,
                borderBottom: `1px solid ${light.hairline}`,
                whiteSpace: "nowrap",
              }}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {shown.map((column, index) => (
              <td
                key={column.key}
                className={column.secondary ? "lw-table-secondary" : "lw-table-cell"}
                style={{
                  padding: "9px 12px 9px 0",
                  textAlign: column.align ?? "left",
                  fontSize: "13px",
                  lineHeight: 1.4,
                  color: column.secondary ? light.textMuted : light.text,
                  borderBottom: `1px solid ${light.hairline}`,
                  fontVariantNumeric: column.align === "right" ? "tabular-nums" : "normal",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {index === 0 && row.href ? (
                  <InlineLink href={row.href}>{row.cells[column.key]}</InlineLink>
                ) : (
                  row.cells[column.key]
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * A code block with its tokens coloured.
 *
 * The colour is inline for the clients that read no stylesheet and a class for
 * the ones that honour the dark block, which is the same two-cut rule the rest
 * of this shell follows. A plain token gets neither, so the markup is a block
 * of text with a few spans in it rather than a span per word.
 */
export const HighlightedCode = ({
  code,
  language,
}: {
  code: string;
  language: HighlightLanguage;
}) => (
  <CodeBlock>
    {tokenize(code, language).map((token, index) =>
      token.kind === "plain" ? (
        token.text
      ) : (
        <span
          key={`${token.kind}-${index}`}
          className={`lw-tok-${token.kind}`}
          style={{ color: light.syntax[token.kind] }}
        >
          {token.text}
        </span>
      ),
    )}
  </CodeBlock>
);

/** A row of counts over a table, each a number with what it counts under it. */
export const CountTiles = ({ tiles }: { tiles: readonly { label: string; value: string }[] }) => (
  <table
    width="100%"
    border={0}
    cellPadding="0"
    cellSpacing="0"
    role="presentation"
    style={{ width: "100%", borderCollapse: "collapse", margin: `${SPACE.row}px 0` }}
  >
    <tbody>
      <tr>
        {tiles.map((tile) => (
          <td
            key={tile.label}
            style={{ width: `${Math.floor(100 / tiles.length)}%`, verticalAlign: "top" }}
          >
            <Text
              className="lw-text"
              style={{ margin: 0, fontSize: "22px", lineHeight: 1.2, color: light.text }}
            >
              {tile.value}
            </Text>
            <Text
              className="lw-muted"
              style={{
                margin: "2px 0 0",
                fontFamily: MONO_FONT,
                fontSize: "10px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: light.textMuted,
              }}
            >
              {tile.label}
            </Text>
          </td>
        ))}
      </tr>
    </tbody>
  </table>
);

/**
 * A key, a licence, a token, a line of code: something to be copied exactly.
 *
 * `breakAnywhere` is for the one case that has no spaces to break on — a
 * licence key is a single 200-character word and has to wrap mid-token or run
 * off the card. Everything else breaks on spaces, because a shell command
 * split down the middle of `langwatch/skills` is a command the reader has to
 * repair before they can use it.
 */
export const CodeBlock = ({
  children,
  breakAnywhere = false,
}: {
  children: ReactNode;
  breakAnywhere?: boolean;
}) => (
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
      overflowWrap: breakAnywhere ? "break-word" : "normal",
      wordBreak: breakAnywhere ? "break-all" : "normal",
    }}
  >
    {children}
  </pre>
);
