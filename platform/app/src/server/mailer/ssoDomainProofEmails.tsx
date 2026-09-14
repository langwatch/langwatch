import {
  SSO_DNS_RECORD_NAME,
  SSO_DNS_RECORD_TYPE,
  ssoDnsRecordName,
} from "@langwatch/identity";
import { render } from "@react-email/render";
import {
  EmailAction,
  type EmailFact,
  EmailFacts,
  EmailParagraph,
  EmailShell,
} from "./emailLayout";
import { sendEmail } from "./emailSender";

/**
 * The two emails a domain's proof going missing produces (ADR-123).
 *
 * Three rules run through both.
 *
 * NEITHER CARRIES THE VALUE. The token that proves a domain is a secret and
 * we keep only its hash, so there is nothing to put in an email even if it
 * were wise to — and it would not be: a value mailed to an administrator is a
 * value in whatever mailbox their address forwards to. Both mails say to ask
 * for a fresh record on the settings page, which is behind a session and a
 * permission.
 *
 * BOTH NAME EXACTLY WHAT TO PUBLISH. Where the record goes and what kind it
 * is are not secret, so they are in the mail: an administrator who deleted a
 * record months ago should not have to open a page to find out what it was
 * called.
 *
 * AND BOTH ARE HONEST ABOUT WHAT IS AND IS NOT AFFECTED. The first says
 * nothing has changed yet, because nothing has. The second says what stopped
 * — new people — and says plainly that everyone already there keeps signing
 * in, because an administrator reading "your domain has lapsed" at 2am will
 * otherwise assume their company has just been locked out.
 */

/** Where the record goes, in the shape both mails render it. */
const recordFacts = (domain: string): EmailFact[] => [
  { label: "Record type", value: SSO_DNS_RECORD_TYPE },
  { label: "Name", value: ssoDnsRecordName({ domain }), mono: true },
  {
    label: "Name (if your provider wants a label)",
    value: SSO_DNS_RECORD_NAME,
    mono: true,
  },
];

/**
 * The record has just gone missing, and there is still time. Sent once, when
 * the evidence first disappears — not on every re-check, because a daily mail
 * saying the same thing is a daily mail somebody filters.
 */
export const sendSsoDomainProofWaveringEmail = async ({
  adminEmail,
  organizationName,
  domain,
  deadline,
  accessSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  domain: string;
  deadline: Date;
  accessSettingsUrl: string;
}) => {
  const html = await render(
    <EmailShell title="We can't find your domain verification record">
      <EmailParagraph>
        The record that proves <strong>{domain}</strong> belongs to{" "}
        <strong>{organizationName}</strong> is no longer published, so we cannot
        confirm the domain is yours.
      </EmailParagraph>
      <EmailParagraph>
        Nothing has changed yet. Single sign-on works exactly as before and
        everyone can still sign in.
      </EmailParagraph>
      <EmailFacts rows={recordFacts(domain)} />
      <EmailParagraph>
        Publish the record again and we will pick it up automatically. If you no
        longer have its value, ask for a fresh record from your access settings
        — we only keep a fingerprint of the old one, never the value itself.
      </EmailParagraph>
      <EmailParagraph>
        If it is still missing on <strong>{deadline.toUTCString()}</strong>,{" "}
        {domain} will stop letting new people join automatically. People already
        in your organization are not affected at any point.
      </EmailParagraph>
      <EmailAction href={accessSettingsUrl} label="Open access settings" />
    </EmailShell>,
  );
  await sendEmail({
    to: adminEmail,
    subject: `Action needed: we can't find the verification record for ${domain}`,
    html,
  });
};

/** The grace ran out. Says what stopped, and — just as loudly — what did not. */
export const sendSsoDomainProofLapsedEmail = async ({
  adminEmail,
  organizationName,
  domain,
  accessSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  domain: string;
  accessSettingsUrl: string;
}) => {
  const html = await render(
    <EmailShell title="Your domain is no longer verified">
      <EmailParagraph>
        The record that proves <strong>{domain}</strong> belongs to{" "}
        <strong>{organizationName}</strong> has been missing for two days, so we
        have stopped treating the domain as proof that somebody works with you.
      </EmailParagraph>
      <EmailParagraph>
        <strong>
          Everyone already in your organization can still sign in.
        </strong>{" "}
        Single sign-on is untouched. What stopped is new people: somebody
        signing in for the first time with a {domain} address will no longer get
        an account automatically, and nobody joins your organization by that
        domain alone. You can still invite anybody, and requests to join still
        reach your administrators.
      </EmailParagraph>
      <EmailFacts rows={recordFacts(domain)} />
      <EmailParagraph>
        Publish the record again and everything goes back to normal on its own —
        there is nothing to re-apply for and nothing to redo. If you no longer
        have its value, ask for a fresh record from your access settings.
      </EmailParagraph>
      <EmailAction href={accessSettingsUrl} label="Open access settings" />
    </EmailShell>,
  );
  await sendEmail({
    to: adminEmail,
    subject: `${domain} is no longer verified for ${organizationName}`,
    html,
  });
};
