import type { AlertType } from "@prisma/client";
import { Column, Link, Row, Section } from "@react-email/components";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Html } from "@react-email/html";
import { Img } from "@react-email/img";
import { render } from "@react-email/render";
import { createHash } from "crypto";
import { EMAIL_RX } from "~/automations/providers/definitions/email/shared";
import type { TriggerData } from "~/pages/api/cron/triggers/types";
import { toDispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger/server";
import { computeDefaultFrom, sendEmail } from "./emailSender";
import {
  buildTriggerNoReplyAddress,
  TEST_FIRE_TRIGGER_ID_SENTINEL,
} from "./triggerNoReply";
import { signUnsubscribeToken } from "./unsubscribeToken";

const logger = createLogger("langwatch:mailer:triggerEmail");

/**
 * ADR-031: every trigger email carries an unsubscribe footer appended OUTSIDE
 * the customer template (so a template author cannot strip it) plus one-click
 * `List-Unsubscribe` headers. The footer offers two scopes — this notification
 * only (token with triggerId) and all notifications from the project (token
 * with null triggerId). Per-recipient sends make the link forge-proof: the
 * token's HMAC binds the link to one recipient address.
 */
/**
 * `render()` returns a full HTML document, so tail-concatenating the footer
 * would land it after `</body></html>` and some mail clients drop content
 * outside the body. Insert the footer immediately before the closing `</body>`
 * tag (case-insensitive) when present; otherwise append (fragments, plain HTML).
 */
export function injectFooterIntoBody(html: string, footerHtml: string): string {
  const bodyClose = /<\/body>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `${footerHtml}</body>`);
  }
  return `${html}${footerHtml}`;
}

function buildUnsubscribe({
  projectId,
  triggerId,
  email,
  baseHost,
}: {
  projectId: string;
  triggerId: string;
  email: string;
  baseHost: string;
}): { footerHtml: string; headers: Record<string, string> } {
  const footerLink = (token: string) =>
    `${baseHost}/unsubscribe?token=${encodeURIComponent(token)}`;
  const apiLink = (token: string) =>
    `${baseHost}/api/unsubscribe?token=${encodeURIComponent(token)}`;

  const triggerToken = signUnsubscribeToken({ projectId, triggerId, email });
  const projectToken = signUnsubscribeToken({
    projectId,
    triggerId: null,
    email,
  });

  const triggerFooterUrl = footerLink(triggerToken);
  const projectFooterUrl = footerLink(projectToken);
  // RFC 8058: one-click POST goes to /api/unsubscribe, not the human page.
  const triggerOneClickUrl = apiLink(triggerToken);

  const footerHtml = `
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #F2F4F8;color:#8B96A5;font-size:12px;line-height:18px;">
      <a href="${triggerFooterUrl}" style="color:#8B96A5;text-decoration:underline;">Stop receiving this notification</a>
      &nbsp;·&nbsp;
      <a href="${projectFooterUrl}" style="color:#8B96A5;text-decoration:underline;">Stop all notifications from this project</a>
    </div>`;

  return {
    footerHtml,
    headers: {
      "List-Unsubscribe": `<${triggerOneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export const sendTriggerEmail = async ({
  triggerEmails,
  triggerData,
  triggerName,
  triggerId,
  projectId,
  projectSlug,
  triggerType,
  triggerMessage,
  isRecipientSent,
  recordRecipientSent,
}: {
  triggerEmails: string[];
  triggerData: TriggerData[];
  triggerName: string;
  /** Stable identifier of the trigger that produced this notification. Used
   *  to derive the per-trigger no-reply local part — see `triggerNoReply.ts`. */
  triggerId: string;
  /** Project that owns the trigger — needed to sign per-recipient unsubscribe
   *  tokens (ADR-031). */
  projectId: string;
  projectSlug: string;
  triggerType: AlertType | null;
  triggerMessage: string;
  /**
   * Optional per-recipient idempotency gate (ADR-031). Two callbacks work in
   * tandem to make the fan-out idempotent at recipient granularity:
   *
   * - `isRecipientSent(hash)` — checked BEFORE sending; returns true if this
   *   recipient hash was already delivered in a prior attempt, causing the
   *   current attempt to skip it.
   * - `recordRecipientSent(hash)` — called AFTER a successful provider call to
   *   persist the delivery record so that future retries can skip it.
   *
   * Callers (outbox dispatcher) back these with TriggerService.isSendClaimed /
   * claimSend (keyed with the recipient hash encoded into the traceId field)
   * so dedup survives across outbox retries. Omitting either callback falls
   * back to always-send behaviour (backward-compatible with existing callers).
   */
  isRecipientSent?: (recipientHash: string) => Promise<boolean>;
  recordRecipientSent?: (recipientHash: string) => Promise<void>;
}) => {
  // The render boundary belongs INSIDE the DispatchError wrap: a render
  // failure (bad React tree, oom, etc.) is a permanent fault for this
  // payload, and the outbox needs to see a typed `DispatchError` so it
  // promotes the row to `dead` instead of looping retries on a payload
  // that can never succeed.
  let emailHtml: string;
  try {
    emailHtml = await render(
      <Html lang="en" dir="ltr">
        <Container
          style={{
            border: "1px solid #F2F4F8",
            borderRadius: "10px",
            padding: "24px",
            paddingBottom: "12px",
          }}
        >
          <Img
            src="https://app.langwatch.ai/images/logo-icon.png"
            alt="LangWatch Logo"
            width="36"
          />
          <Heading as="h1">
            {triggerType ? `(${triggerType}) ` : ""}LangWatch Trigger
          </Heading>
          <Heading as="h3">{triggerName}</Heading>
          <p>
            This is an automated email generated by your configured triggers.
            Below, you will find the messages that initiated this action.
          </p>
          {triggerMessage && <p>{triggerMessage}</p>}
          <TriggerTable triggerData={triggerData} projectSlug={projectSlug} />
        </Container>
      </Html>,
    );
  } catch (err) {
    throw toDispatchError(err, {
      message: `Trigger email render failed for trigger "${triggerName}"`,
      retryable: false,
    });
  }

  const subject = `${
    triggerType ? `(${triggerType}) ` : ""
  }Trigger - ${triggerName}`;
  try {
    await sendPerRecipient({
      recipients: triggerEmails,
      triggerId,
      projectId,
      subject,
      html: emailHtml,
      isRecipientSent,
      recordRecipientSent,
    });
  } catch (err) {
    throw toDispatchError(err, {
      message: `Trigger email dispatch failed for trigger "${triggerName}"`,
    });
  }
};

/**
 * Sends one envelope per recipient (ADR-031). Each recipient gets the
 * no-reply To (so addresses can't be enumerated), the rendered body with a
 * recipient-specific unsubscribe footer appended, and one-click
 * `List-Unsubscribe` headers. The test-fire sentinel skips the footer/headers:
 * a test to your own inbox needs no suppression context, and the token
 * requires a real trigger id.
 */
async function sendPerRecipient({
  recipients,
  triggerId,
  projectId,
  subject,
  html,
  isRecipientSent,
  recordRecipientSent,
}: {
  recipients: string[];
  triggerId: string;
  projectId: string;
  subject: string;
  html: string;
  isRecipientSent?: (recipientHash: string) => Promise<boolean>;
  recordRecipientSent?: (recipientHash: string) => Promise<void>;
}): Promise<void> {
  const baseHost = env.BASE_HOST;
  const noReplyTo = buildTriggerNoReplyAddress({
    defaultFrom: computeDefaultFrom(),
    triggerId,
  });
  const isSentinel = triggerId === TEST_FIRE_TRIGGER_ID_SENTINEL;

  for (const recipient of recipients) {
    // Defense in depth: actionParams is free-form JSON, so a recipient may not
    // have been validated against the email schema. Skip malformed addresses
    // before they reach the provider's `bcc` slot (also blocks CRLF smuggling).
    if (!EMAIL_RX.test(recipient)) {
      logger.warn(
        { triggerId, projectId },
        "Skipping malformed trigger email recipient",
      );
      continue;
    }

    // Per-recipient idempotency: hash the address (privacy) and skip if this
    // recipient was already successfully delivered in a prior attempt.
    const recipientHash = createHash("sha256")
      .update(recipient)
      .digest("hex")
      .slice(0, 16);
    if (isRecipientSent && (await isRecipientSent(recipientHash))) {
      continue;
    }

    if (isSentinel) {
      await sendEmail({ to: noReplyTo, bcc: [recipient], subject, html });
      // Sentinel sends don't participate in the dedup lifecycle.
      continue;
    }
    const { footerHtml, headers } = buildUnsubscribe({
      projectId,
      triggerId,
      email: recipient,
      baseHost,
    });
    await sendEmail({
      to: noReplyTo,
      bcc: [recipient],
      subject,
      html: injectFooterIntoBody(html, footerHtml),
      headers,
    });

    // Record delivery AFTER a successful provider call so that a retryable
    // failure does not permanently suppress the retry for this recipient.
    if (recordRecipientSent) {
      await recordRecipientSent(recipientHash);
    }
  }
}

/**
 * Sends a pre-rendered (customer-authored, ADR-036) trigger email. Mirrors the
 * send block of `sendTriggerEmail` exactly — same no-reply `to`, `bcc`
 * recipients, and DispatchError classification — but takes the subject/html as
 * already-rendered strings instead of building the legacy React tree.
 */
export const sendRenderedTriggerEmail = async ({
  triggerEmails,
  triggerId,
  projectId,
  subject,
  html,
  isRecipientSent,
  recordRecipientSent,
}: {
  triggerEmails: string[];
  triggerId: string;
  /** Project that owns the trigger — needed to sign per-recipient unsubscribe
   *  tokens (ADR-031). */
  projectId: string;
  subject: string;
  html: string;
  /** Same per-recipient idempotency gate as `sendTriggerEmail` — see its
   *  doc comment. */
  isRecipientSent?: (recipientHash: string) => Promise<boolean>;
  recordRecipientSent?: (recipientHash: string) => Promise<void>;
}) => {
  try {
    await sendPerRecipient({
      recipients: triggerEmails,
      triggerId,
      projectId,
      subject,
      html,
      isRecipientSent,
      recordRecipientSent,
    });
  } catch (err) {
    throw toDispatchError(err, {
      message: `Trigger email dispatch failed for trigger "${triggerId}"`,
    });
  }
};

const TriggerTable = ({
  triggerData,
  projectSlug,
}: {
  triggerData: TriggerData[];
  projectSlug: string;
}) => {
  const getLink = (data: TriggerData) => {
    // Check if this is a custom graph trigger
    if (data.graphId) {
      return `${env.BASE_HOST}/${projectSlug}/analytics/custom/${data.graphId}`;
    }
    // Regular trace link
    if (data.traceId) {
      return `${env.BASE_HOST}/${projectSlug}/messages/${data.traceId}`;
    }
    return "#";
  };

  const getDisplayText = (data: TriggerData) => {
    // For custom graphs, show a more user-friendly text
    if (data.graphId) {
      return "View Graph";
    }
    return data.traceId ?? "View";
  };

  return (
    <Section>
      {triggerData.slice(0, 10).map((data, index) => (
        <Row key={index}>
          <Column>
            <Link href={getLink(data)}>{getDisplayText(data)}</Link>
          </Column>
        </Row>
      ))}
    </Section>
  );
};
