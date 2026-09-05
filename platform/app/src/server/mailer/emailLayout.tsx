import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Section,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import {
  EMAIL_COLOR,
  EMAIL_FONT,
  EMAIL_RADIUS,
  EMAIL_SPACE,
  EMAIL_TYPE,
  EMAIL_WIDTH,
  EMAIL_WORDMARK,
} from "./emailTheme";

/**
 * The card every LangWatch email is, and the handful of rows that go in it.
 *
 * It is the auth screens' card, posted: the wordmark centred at the top, one
 * heading under it, and then a full-width left-aligned column of whatever the
 * mail is about. The same component in every template, so somebody who
 * receives two of them a month apart sees one surface rather than eleven that
 * were each styled the day they were written.
 *
 * Every rule the medium imposes is applied here once: tables rather than flex,
 * inline styles rather than a stylesheet, an explicit colour on every surface,
 * a system font stack with no remote face, and a link with its padding on the
 * anchor so it is still a button in a client that drops the background.
 *
 * Design source: `src/components/auth/AuthCard.tsx` for the shape,
 * `emailTheme.ts` for the values.
 */

const bodyStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: EMAIL_COLOR.page,
  fontFamily: EMAIL_FONT.body,
  color: EMAIL_COLOR.text,
  // Two clients read this rather than the declarations above, and both would
  // otherwise widen the type on a small screen until the measure breaks.
  WebkitTextSizeAdjust: "100%",
  textSizeAdjust: "100%",
};

const pageStyle: CSSProperties = {
  width: "100%",
  maxWidth: EMAIL_WIDTH.card,
  margin: "0 auto",
  padding: EMAIL_SPACE.page,
};

const cardStyle: CSSProperties = {
  backgroundColor: EMAIL_COLOR.ground,
  border: `1px solid ${EMAIL_COLOR.cardBorder}`,
  borderRadius: EMAIL_RADIUS.card,
  paddingTop: EMAIL_SPACE.cardTop,
  paddingLeft: EMAIL_SPACE.cardX,
  paddingRight: EMAIL_SPACE.cardX,
  paddingBottom: EMAIL_SPACE.cardBottom,
};

const titleStyle: CSSProperties = {
  margin: `${EMAIL_SPACE.headerGap} 0 0 0`,
  fontFamily: EMAIL_FONT.body,
  fontSize: EMAIL_TYPE.title.size,
  fontWeight: EMAIL_TYPE.title.weight,
  letterSpacing: EMAIL_TYPE.title.tracking,
  lineHeight: EMAIL_TYPE.title.leading,
  color: EMAIL_COLOR.text,
  textAlign: "center",
};

/** Inline anchors inside prose: the brand, underlined, never a naked colour. */
export const emailLinkStyle: CSSProperties = {
  color: EMAIL_COLOR.action,
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

export function EmailShell({
  title,
  logoUrl,
  footer,
  children,
}: {
  title: string;
  /** A masthead image in the wordmark's slot, where a mail has its own. */
  logoUrl?: string;
  /** Fine print under the card: nothing louder, and nothing by default. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Body style={bodyStyle}>
        <Container style={pageStyle}>
          <Section style={cardStyle}>
            <Section style={{ textAlign: "center" }}>
              {logoUrl ? (
                <Img
                  src={logoUrl}
                  alt={EMAIL_WORDMARK.alt}
                  style={{
                    display: "block",
                    margin: "0 auto",
                    width: "100%",
                    maxWidth: "220px",
                    height: "auto",
                    border: 0,
                    outline: "none",
                    textDecoration: "none",
                  }}
                />
              ) : (
                <Img
                  src={EMAIL_WORDMARK.src}
                  alt={EMAIL_WORDMARK.alt}
                  width={EMAIL_WORDMARK.width}
                  height={EMAIL_WORDMARK.height}
                  style={{
                    display: "block",
                    margin: "0 auto",
                    border: 0,
                    outline: "none",
                    textDecoration: "none",
                  }}
                />
              )}
              <Heading as="h1" style={titleStyle}>
                {title}
              </Heading>
            </Section>
            <Section style={{ paddingTop: EMAIL_SPACE.headerToBody }}>
              {children}
            </Section>
          </Section>
          {footer ? (
            <Section
              style={{
                paddingTop: EMAIL_SPACE.finePrint,
                paddingLeft: EMAIL_SPACE.cardX,
                paddingRight: EMAIL_SPACE.cardX,
              }}
            >
              {footer}
            </Section>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}

/**
 * One paragraph of the mail. `tone` picks the weight of voice, never a new
 * colour: body ink for what the mail says, the muted step for what it adds.
 */
export function EmailParagraph({
  children,
  tone = "body",
  style,
}: {
  children: ReactNode;
  tone?: "body" | "muted";
  style?: CSSProperties;
}) {
  return (
    <Text
      style={{
        margin: `0 0 ${EMAIL_SPACE.row} 0`,
        fontSize: EMAIL_TYPE.body.size,
        lineHeight: EMAIL_TYPE.body.leading,
        color: tone === "muted" ? EMAIL_COLOR.textMuted : EMAIL_COLOR.text,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

/** A heading inside the body column, for a mail with more than one part. */
export function EmailSectionHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h2"
      style={{
        margin: `${EMAIL_SPACE.block} 0 8px 0`,
        fontFamily: EMAIL_FONT.body,
        fontSize: EMAIL_TYPE.section.size,
        fontWeight: EMAIL_TYPE.section.weight,
        letterSpacing: EMAIL_TYPE.section.tracking,
        lineHeight: EMAIL_TYPE.section.leading,
        color: EMAIL_COLOR.text,
      }}
    >
      {children}
    </Heading>
  );
}

/**
 * The one orange thing on the page.
 *
 * The padding is on the anchor and the colours are declared on it, so the
 * shape survives a client that keeps inline styles and drops everything else.
 * The border matches the fill rather than contrasting with it: it exists to
 * hold the button's edge where the fill is stripped, not to draw a ring.
 */
export function EmailAction({ href, label }: { href: string; label: string }) {
  return (
    <Section style={{ paddingTop: "4px", paddingBottom: EMAIL_SPACE.row }}>
      <Button
        href={href}
        style={{
          display: "inline-block",
          backgroundColor: EMAIL_COLOR.action,
          border: `1px solid ${EMAIL_COLOR.action}`,
          color: EMAIL_COLOR.onAction,
          fontFamily: EMAIL_FONT.body,
          fontSize: EMAIL_TYPE.action.size,
          fontWeight: EMAIL_TYPE.action.weight,
          lineHeight: "20px",
          padding: "12px 24px",
          borderRadius: EMAIL_RADIUS.action,
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        {label}
      </Button>
    </Section>
  );
}

/**
 * The warm tint, doing the one job it does on the auth screens: holding a block
 * apart from the prose around it without raising its voice.
 */
export function EmailCallout({ children }: { children: ReactNode }) {
  return (
    <Section
      style={{
        backgroundColor: EMAIL_COLOR.tint,
        borderRadius: EMAIL_RADIUS.field,
        padding: "16px 18px",
        marginBottom: EMAIL_SPACE.row,
      }}
    >
      {children}
    </Section>
  );
}

/** The quietest voice on the card. */
export function EmailFinePrint({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        margin: 0,
        fontSize: EMAIL_TYPE.finePrint.size,
        lineHeight: EMAIL_TYPE.finePrint.leading,
        color: EMAIL_COLOR.textSubtle,
      }}
    >
      {children}
    </Text>
  );
}

export interface EmailFact {
  label: string;
  value: ReactNode;
  /** Identifiers, keys and amounts, which are read character by character. */
  mono?: boolean;
}

/**
 * The label-and-value block: a licence's terms, a request's context. One
 * table, so the values line up in every client that has ever rendered one.
 */
export function EmailFacts({ rows }: { rows: EmailFact[] }) {
  return (
    <Section style={{ marginBottom: EMAIL_SPACE.row }}>
      <table
        style={{ borderCollapse: "collapse", width: "100%" }}
        cellPadding={0}
        cellSpacing={0}
      >
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td
                style={{
                  padding: "7px 16px 7px 0",
                  fontSize: EMAIL_TYPE.label.size,
                  fontWeight: EMAIL_TYPE.label.weight,
                  lineHeight: EMAIL_TYPE.label.leading,
                  color: EMAIL_COLOR.textMuted,
                  whiteSpace: "nowrap",
                  verticalAlign: "top",
                  textAlign: "left",
                }}
              >
                {row.label}
              </td>
              <td
                style={{
                  padding: "7px 0",
                  fontSize: EMAIL_TYPE.small.size,
                  lineHeight: EMAIL_TYPE.small.leading,
                  color: EMAIL_COLOR.text,
                  fontFamily: row.mono ? EMAIL_FONT.mono : EMAIL_FONT.body,
                  width: "100%",
                }}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
