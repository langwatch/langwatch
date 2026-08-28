import { Button, Container, Heading, Html, Img } from "@react-email/components";
import { render } from "@react-email/render";
import { sendEmail } from "./emailSender";

/**
 * The four join-request emails (D12).
 *
 * Two rules run through all of them.
 *
 * No mail carries an action link that decides anything. An admin approves in
 * the members area, behind their session; a link in mail that approved a
 * request would be a second, unauthenticated way to add somebody to an
 * organization — the same reason D11's re-request mail carries no "resend it
 * for them" link.
 *
 * And a rejection says nothing about why, and does not name who said no. The
 * ending is deliberately quiet: an admin who has to justify a refusal is an
 * admin who hesitates to make one, and a requester who learns which colleague
 * turned them down has learned something that is not theirs.
 */

const shell = ({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) => (
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
      <Heading as="h1">{heading}</Heading>
      {children}
    </Container>
  </Html>
);

const actionButton = (href: string, label: string) => (
  <Button
    href={href}
    style={{
      padding: "10px 20px",
      color: "white",
      backgroundColor: "#ED8926",
      textDecoration: "none",
      borderRadius: "6px",
    }}
  >
    {label}
  </Button>
);

/** Somebody on the company domain is waiting. Sent to every admin. */
export const sendJoinRequestArrivedEmail = async ({
  adminEmail,
  organizationName,
  requesterName,
  domain,
  membersSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  requesterName: string;
  domain: string;
  membersSettingsUrl: string;
}) => {
  const html = await render(
    shell({
      heading: "Someone asked to join your organization",
      children: (
        <>
          <p>
            <strong>{requesterName}</strong> has a verified{" "}
            <strong>{domain}</strong> address and asked to join{" "}
            <strong>{organizationName}</strong> on LangWatch.
          </p>
          <p>
            Approving adds them with your organization&apos;s default role. If
            they need more than that, send them an invitation instead — that is
            the flow that carries roles and teams.
          </p>
          {actionButton(membersSettingsUrl, "Open members settings")}
          <p>
            If nobody answers, the request lapses on its own after two weeks.
          </p>
        </>
      ),
    }),
  );
  await sendEmail({
    to: adminEmail,
    subject: `${requesterName} asked to join ${organizationName}`,
    html,
  });
};

/** The one nudge, on the seventh day. */
export const sendJoinRequestReminderEmail = async ({
  adminEmail,
  organizationName,
  requesterName,
  membersSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  requesterName: string;
  membersSettingsUrl: string;
}) => {
  const html = await render(
    shell({
      heading: "A request to join is still waiting",
      children: (
        <>
          <p>
            <strong>{requesterName}</strong> asked to join{" "}
            <strong>{organizationName}</strong> a week ago and nobody has
            answered yet.
          </p>
          <p>
            It lapses in another week. This is the only reminder we send about
            it.
          </p>
          {actionButton(membersSettingsUrl, "Open members settings")}
        </>
      ),
    }),
  );
  await sendEmail({
    to: adminEmail,
    subject: `${requesterName} is still waiting to join ${organizationName}`,
    html,
  });
};

/** You are in. Sent to the requester. */
export const sendJoinRequestApprovedEmail = async ({
  requesterEmail,
  organizationName,
  organizationUrl,
}: {
  requesterEmail: string;
  organizationName: string;
  organizationUrl: string;
}) => {
  const html = await render(
    shell({
      heading: `You are in ${organizationName}`,
      children: (
        <>
          <p>
            Your request to join <strong>{organizationName}</strong> on
            LangWatch was approved. You are a member now, with the
            organization&apos;s default role.
          </p>
          {actionButton(organizationUrl, `Open ${organizationName}`)}
        </>
      ),
    }),
  );
  await sendEmail({
    to: requesterEmail,
    subject: `You are now a member of ${organizationName}`,
    html,
  });
};

/**
 * It was not approved. No reason, and nobody named — see the module docblock.
 */
export const sendJoinRequestRejectedEmail = async ({
  requesterEmail,
  organizationName,
}: {
  requesterEmail: string;
  organizationName: string;
}) => {
  const html = await render(
    shell({
      heading: "Your request was not approved",
      children: (
        <>
          <p>
            Your request to join <strong>{organizationName}</strong> on
            LangWatch was not approved.
          </p>
          <p>
            If you think that is a mistake, the people who can change it are
            your colleagues there — ask one of them for an invitation.
          </p>
        </>
      ),
    }),
  );
  await sendEmail({
    to: requesterEmail,
    subject: `Your request to join ${organizationName} was not approved`,
    html,
  });
};

/** Nobody answered in time. Sent to the requester, who may ask again. */
export const sendJoinRequestExpiredEmail = async ({
  requesterEmail,
  organizationName,
}: {
  requesterEmail: string;
  organizationName: string;
}) => {
  const html = await render(
    shell({
      heading: "Your request lapsed",
      children: (
        <>
          <p>
            Nobody answered your request to join{" "}
            <strong>{organizationName}</strong> on LangWatch within two weeks,
            so it lapsed.
          </p>
          <p>You can ask again whenever you like.</p>
        </>
      ),
    }),
  );
  await sendEmail({
    to: requesterEmail,
    subject: `Your request to join ${organizationName} lapsed`,
    html,
  });
};

/**
 * A colleague walked straight in on the domain setting. Sent to every admin,
 * after the fact and straight away — a surprising join has to be visible the
 * moment it happens, which is the whole price of admitting somebody with
 * nobody in the loop.
 */
export const sendDomainAutoJoinedEmail = async ({
  adminEmail,
  organizationName,
  memberName,
  domain,
  membersSettingsUrl,
}: {
  adminEmail: string;
  organizationName: string;
  memberName: string;
  domain: string;
  membersSettingsUrl: string;
}) => {
  const html = await render(
    shell({
      heading: "A colleague joined automatically",
      children: (
        <>
          <p>
            <strong>{memberName}</strong> verified a <strong>{domain}</strong>{" "}
            address and joined <strong>{organizationName}</strong> on LangWatch
            with the organization&apos;s default role.
          </p>
          <p>
            They were admitted by your automatic joining setting for that
            domain, not by anybody clicking approve. You can change that
            setting, or remove them, from members settings.
          </p>
          {actionButton(membersSettingsUrl, "Open members settings")}
        </>
      ),
    }),
  );
  await sendEmail({
    to: adminEmail,
    subject: `${memberName} joined ${organizationName} automatically`,
    html,
  });
};
