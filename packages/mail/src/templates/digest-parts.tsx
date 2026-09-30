import { Link, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { z } from "zod";

import { EmailLayout, InlineLink, expressive } from "./email-layout.tsx";

const { light } = expressive;

/** The week's "what's new" card: one title, one body, one already-tracked link. */
export const digestUpdateSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  gradient: z.enum(["ember", "sky", "meadow"]),
  linkLabel: z.string().min(1),
  linkUrl: z.url().describe("Already a tracked redirect"),
});

export type DigestUpdate = z.infer<typeof digestUpdateSchema>;

/** What every digest carries, so each template spreads it into its own props. */
export const digestCommonFields = {
  weekLabel: z.string().min(1).describe("The week this covers, e.g. Sep 22 to 28"),
  whatsNew: digestUpdateSchema.optional().describe("Published for the week, or absent"),
  unsubscribeUrl: z.url().describe("Already a tracked redirect"),
};

/** Pastel cuts over a solid, so a client that drops gradients keeps a flat tint. */
const GRADIENTS = {
  ember: { solid: "#ffcfa8", image: "linear-gradient(135deg, #ffe6d2 0%, #ffaf6e 100%)" },
  sky: { solid: "#d6e3fa", image: "linear-gradient(135deg, #e8f0fd 0%, #b9cff4 100%)" },
  meadow: { solid: "#cfe9d8", image: "linear-gradient(135deg, #e6f5ec 0%, #a9d9bb 100%)" },
} as const;

/**
 * Ink on pastel in both colour schemes: the card keeps its own ground, so its
 * text takes no `lw-*` class, which the dark cut would turn pale on pale.
 */
export const WhatsNewCard = ({ update }: { update: DigestUpdate }) => {
  const { solid, image } = GRADIENTS[update.gradient];

  return (
    <table
      width="100%"
      border={0}
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{ width: "100%", borderCollapse: "separate", margin: "20px 0" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              padding: "16px 18px",
              backgroundColor: solid,
              backgroundImage: image,
              borderRadius: "10px",
            }}
          >
            <Text
              style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 600, color: light.text }}
            >
              {update.title}
            </Text>
            <Text
              style={{ margin: "0 0 10px", fontSize: "14px", lineHeight: 1.55, color: light.text }}
            >
              {update.body}
            </Text>
            <Link
              href={update.linkUrl}
              style={{ fontSize: "14px", fontWeight: 600, color: light.text }}
            >
              {update.linkLabel}
            </Link>
          </td>
        </tr>
      </tbody>
    </table>
  );
};

/** The one number the mail is about, large, with a line saying what it is. */
const Hero = ({ value, caption }: { value: string; caption: string }) => (
  <Section style={{ margin: "0 0 4px" }}>
    <Text
      className="lw-text"
      style={{
        margin: 0,
        fontSize: "48px",
        lineHeight: 1.1,
        fontWeight: 600,
        letterSpacing: "-0.03em",
        color: light.text,
      }}
    >
      {value}
    </Text>
    <Text
      className="lw-muted"
      style={{ margin: "6px 0 0", fontSize: "15px", lineHeight: 1.5, color: light.textMuted }}
    >
      {caption}
    </Text>
  </Section>
);

/** Why it arrived, and the one-click way out. */
const DigestFootNote = ({ reason, unsubscribeUrl }: { reason: string; unsubscribeUrl: string }) => (
  <>
    {`${reason} `}
    <InlineLink href={unsubscribeUrl}>Unsubscribe</InlineLink>
    {" from the weekly summary."}
  </>
);

/**
 * The shared shell of every digest: hero, then the optional card under it,
 * then the template's own stats and its one call to action as children.
 */
export const DigestFrame = ({
  preview,
  heading,
  hero,
  whatsNew,
  reason,
  unsubscribeUrl,
  children,
}: {
  preview: string;
  heading: string;
  hero?: { value: string; caption: string };
  whatsNew?: DigestUpdate;
  reason: string;
  unsubscribeUrl: string;
  children?: ReactNode;
}) => (
  <EmailLayout
    preview={preview}
    heading={heading}
    footNote={<DigestFootNote reason={reason} unsubscribeUrl={unsubscribeUrl} />}
  >
    {hero && <Hero value={hero.value} caption={hero.caption} />}
    {whatsNew && <WhatsNewCard update={whatsNew} />}
    {children}
  </EmailLayout>
);

/** A meter as two table cells, for the same Outlook reasons as the usage email's. */
export const Meter = ({ percent }: { percent: number }) => {
  const filled = Math.min(Math.max(percent, 0), 100);

  return (
    <table
      width="100%"
      border={0}
      cellPadding="0"
      cellSpacing="0"
      role="presentation"
      style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", margin: "16px 0" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              width: `${filled}%`,
              height: "8px",
              backgroundColor: light.detail,
              borderRadius: "4px 0 0 4px",
              fontSize: 0,
              lineHeight: "8px",
            }}
          >
            &nbsp;
          </td>
          <td
            className="lw-code"
            style={{
              width: `${100 - filled}%`,
              backgroundColor: light.field,
              borderRadius: "0 4px 4px 0",
              fontSize: 0,
              lineHeight: "8px",
            }}
          >
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  );
};

/** Fixed locale, so a rendered mail reads the same on every machine that sends it. */
export const formatCount = (value: number): string => value.toLocaleString("en-US");

export const formatCompact = (value: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export const formatUsd = (value: number): string =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const formatPercent = (value: number): string => `${Math.round(value)}%`;

export const formatLatency = (milliseconds: number): string =>
  milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`;

export const formatMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);

  return hours === 0 ? `${rest} min` : `${hours} h ${rest} min`;
};
