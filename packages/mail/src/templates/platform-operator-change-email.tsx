import { z } from "zod";

import { DetailTable, EmailLayout, Muted, Paragraph, PrimaryButton } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/**
 * Tells every platform operator that someone was given or lost the role, so a grant nobody
 * expected is seen by people who can revoke it.
 */
export const platformOperatorChangeEmailProps = z.object({
  installation: z.string().min(1),
  change: z.enum(["granted", "revoked"]),
  /** The person whose role changed, as their name or, without one, their address. */
  subjectName: z.string().min(1),
  subjectEmail: z.string().nullable(),
  /** Who made the change: an operator's name, or the recovery task run from a shell. */
  actorName: z.string().min(1),
  /** The Operators page, absolute; null when the install has no public address to link to. */
  operatorsUrl: z.url().nullable(),
});

export type PlatformOperatorChangeEmailProps = z.infer<typeof platformOperatorChangeEmailProps>;

const headingOf = ({ change, subjectName }: PlatformOperatorChangeEmailProps): string =>
  change === "granted"
    ? `${subjectName} is now a platform operator`
    : `${subjectName} is no longer a platform operator`;

/** The subject line: whose role changed, and on which installation. */
export const platformOperatorChangeEmailSubject = (
  props: PlatformOperatorChangeEmailProps,
): string => `${headingOf(props)} on ${props.installation}`;

/** The notice body: who changed whose role, and what to do if nobody expected it. */
export const PlatformOperatorChangeEmail = (props: PlatformOperatorChangeEmailProps) => {
  const { change, subjectName, subjectEmail, actorName, installation, operatorsUrl } = props;
  const verb = change === "granted" ? "gave" : "removed";
  const preposition = change === "granted" ? "to" : "from";

  return (
    <EmailLayout preview={platformOperatorChangeEmailSubject(props)} heading={headingOf(props)}>
      <Paragraph>
        {`${actorName} ${verb} the platform operator role ${preposition} ${subjectName} on ${installation}.`}
      </Paragraph>
      <DetailTable
        rows={[
          { label: "Person", value: subjectEmail ?? subjectName },
          { label: "Changed by", value: actorName },
        ]}
      />
      <Muted>
        {change === "granted"
          ? "Platform operators can see and change every organization on this installation. If you did not expect this, revoke the role on the Operators page now."
          : "If you did not expect this, check the Operators page to see who still holds the role."}
      </Muted>
      {operatorsUrl ? <PrimaryButton href={operatorsUrl}>Open Operators</PrimaryButton> : null}
      <Muted>Every platform operator gets this email when the role is given or removed.</Muted>
    </EmailLayout>
  );
};

export const platformOperatorChangeEmailTemplate = defineTemplate({
  id: "platform-operator-change",
  title: "Platform operator role changed",
  sentWhen:
    "Someone is given or loses the platform operator role; every operator, and the person whose role changed, is told.",
  schema: platformOperatorChangeEmailProps,
  subject: platformOperatorChangeEmailSubject,
  Component: PlatformOperatorChangeEmail,
  fixtures: {
    default: {
      installation: "app.langwatch.ai",
      change: "granted",
      subjectName: "Ada Lovelace",
      subjectEmail: "ada@langwatch.ai",
      actorName: "Riley Chen",
      operatorsUrl: "https://app.langwatch.ai/ops/operators",
    },
    "role removed": {
      installation: "app.langwatch.ai",
      change: "revoked",
      subjectName: "Ada Lovelace",
      subjectEmail: "ada@langwatch.ai",
      actorName: "Riley Chen",
      operatorsUrl: "https://app.langwatch.ai/ops/operators",
    },
    "granted by the recovery task": {
      installation: "langwatch.acme.example",
      change: "granted",
      subjectName: "morgan@acme.example",
      subjectEmail: "morgan@acme.example",
      actorName: "The recovery task",
      operatorsUrl: "https://langwatch.acme.example/ops/operators",
    },
  },
});

/** Renders the notice for ops, which sends it to each operator itself. */
export const renderPlatformOperatorChangeEmail = async (
  props: PlatformOperatorChangeEmailProps,
): Promise<{ subject: string; html: string }> => {
  const { subject, html } = await renderMailTemplate(platformOperatorChangeEmailTemplate, props);
  return { subject, html };
};
