import { Button, Link, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import { z } from "zod";

import { EmailLayout, InlineLink, expressive } from "./email-layout.tsx";

const { light } = expressive;

/** What every digest carries, so its template spreads it into its own props. */
export const digestCommonFields = {
  weekLabel: z.string().min(1).describe("The week this covers, e.g. Sep 22 to 28"),
  preferencesUrl: z.url().describe("Where the footer link opens: the person's email preferences"),
};

/** Why it arrived, and where to turn it off: the person's email preferences. */
const DigestFootNote = ({ reason, preferencesUrl }: { reason: string; preferencesUrl: string }) => (
  <>
    {`${reason} `}
    <InlineLink href={preferencesUrl}>Manage your email preferences</InlineLink>
    {" to turn off the weekly digest."}
  </>
);

/** The digest's shell: the heading, the template's own body, and why it arrived. */
export const DigestFrame = ({
  preview,
  heading,
  reason,
  preferencesUrl,
  darkStyles,
  children,
}: {
  preview: string;
  heading: string;
  reason: string;
  preferencesUrl: string;
  darkStyles?: string;
  children?: ReactNode;
}) => (
  <EmailLayout
    preview={preview}
    heading={heading}
    footNote={<DigestFootNote reason={reason} preferencesUrl={preferencesUrl} />}
    {...(darkStyles ? { darkStyles } : {})}
  >
    {children}
  </EmailLayout>
);

/**
 * A row's kind, as a small label; solid means it needs you. No `lw-*` text class (the dark cut
 * would turn it pale on pale). An outlined chip shows the card's ground; `darkClass` gives it a
 * dark-mode colour when its light one is too faint on the dark card.
 */
export const Chip = ({
  label,
  colour,
  solid,
  darkClass,
}: {
  label: string;
  colour: string;
  solid: boolean;
  darkClass?: string;
}) => (
  <span
    {...(!solid && darkClass ? { className: darkClass } : {})}
    style={{
      display: "inline-block",
      minWidth: "74px",
      textAlign: "center",
      fontSize: "11px",
      fontWeight: 700,
      padding: "3px 6px",
      borderRadius: "4px",
      backgroundColor: solid ? colour : "transparent",
      color: solid ? "#ffffff" : colour,
      border: `1px solid ${colour}`,
    }}
  >
    {label}
  </span>
);

const ROW_BUTTON_STYLE: CSSProperties = {
  display: "inline-block",
  padding: "7px 14px",
  lineHeight: "18px",
  fontSize: "13px",
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: "8px",
};

const PRIMARY_ROW_BUTTON: CSSProperties = {
  ...ROW_BUTTON_STYLE,
  backgroundColor: light.action,
  border: `1px solid ${light.action}`,
  color: light.onAction,
};

const SECONDARY_ROW_BUTTON: CSSProperties = {
  ...ROW_BUTTON_STYLE,
  backgroundColor: light.card,
  border: `1px solid ${light.cardBorder}`,
  color: light.text,
};

/** A row's action: the first in the email is the ink one, the second is outlined. */
export type FeedRowButton = Readonly<{ label: string; href: string; primary: boolean }>;

/**
 * One feed row as two table cells (Outlook keeps cells side by side): the chip, then a linked
 * title, one context line, and the row's button and quieter text link when it has them.
 */
export const FeedRow = ({
  chip,
  title,
  href,
  context,
  button,
  link,
}: {
  chip: ReactNode;
  title: string;
  href: string;
  context: string;
  button?: FeedRowButton;
  link?: Readonly<{ before?: string; label: string; href: string }>;
}) => {
  const cellBorder = { borderTop: `1px solid ${light.hairline}` };
  return (
    <tr>
      <td
        className="lw-rule"
        style={{ ...cellBorder, width: "86px", padding: "13px 10px 12px 0", verticalAlign: "top" }}
      >
        {chip}
      </td>
      <td className="lw-rule" style={{ ...cellBorder, padding: "11px 0", verticalAlign: "top" }}>
        <Link
          className="lw-link"
          href={href}
          style={{
            fontSize: "15px",
            fontWeight: 600,
            lineHeight: 1.35,
            color: light.accentText,
            textDecoration: "none",
          }}
        >
          {title}
        </Link>
        <Text
          className="lw-muted"
          style={{ margin: "2px 0 0", fontSize: "13.5px", lineHeight: 1.5, color: light.textMuted }}
        >
          {context}
        </Text>
        {(button || link) && (
          <Text style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: "20px" }}>
            {button && (
              <Button
                className={button.primary ? "lw-action" : "lw-action-secondary"}
                href={button.href}
                style={button.primary ? PRIMARY_ROW_BUTTON : SECONDARY_ROW_BUTTON}
              >
                {button.label}
              </Button>
            )}
            {button && link && " "}
            {link?.before && (
              <span className="lw-muted" style={{ fontSize: "13px", color: light.textMuted }}>
                {link.before}
              </span>
            )}
            {link && (
              <InlineLink href={link.href}>
                <span style={{ fontSize: "13px" }}>{link.label}</span>
              </InlineLink>
            )}
          </Text>
        )}
      </td>
    </tr>
  );
};

/** Fixed locale, so a rendered mail reads the same on every machine that sends it. */
export const formatCount = (value: number): string => value.toLocaleString("en-US");

export const formatCompact = (value: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export const formatUsd = (value: number): string =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const formatPercent = (value: number): string => `${Math.round(value)}%`;

/** Multiplied before dividing, so 900 of 1,000 reads exactly 90. */
export const percentOf = ({ part, whole }: { part: number; whole: number }): number =>
  whole > 0 ? (part * 100) / whole : 0;

export const formatLatency = (milliseconds: number): string =>
  milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
