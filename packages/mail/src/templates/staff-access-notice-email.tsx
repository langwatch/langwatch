import { z } from "zod";

import { DetailTable, EmailLayout, FinePrint, Paragraph } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

export const staffAccessNoticeEmailProps = z.object({
  /** What the operator did, in one line; it is the subject and the heading. */
  headline: z.string().min(1),
  operatorName: z.string().min(1),
  details: z.array(z.object({ label: z.string().min(1), value: z.string() })),
});

export type StaffAccessNoticeEmailProps = z.infer<typeof staffAccessNoticeEmailProps>;

export const staffAccessNoticeEmailSubject = ({
  headline,
}: Pick<StaffAccessNoticeEmailProps, "headline">): string => headline;

export const StaffAccessNoticeEmail = ({
  headline,
  operatorName,
  details,
}: StaffAccessNoticeEmailProps) => (
  <EmailLayout preview={`${operatorName}: ${headline}`} heading={headline}>
    <Paragraph>
      {`${operatorName} just used staff access. Every other platform operator gets this email.`}
    </Paragraph>
    <DetailTable rows={[{ label: "Operator", value: operatorName }, ...details]} />
    <FinePrint>If you did not expect this, end every session from Ops, Agent access.</FinePrint>
  </EmailLayout>
);

export const staffAccessNoticeEmailTemplate = defineTemplate({
  id: "staff-access-notice",
  title: "Staff access notice",
  sentWhen:
    "A platform operator enrolled an agent for staff access or approved a request; sent to every other operator.",
  schema: staffAccessNoticeEmailProps,
  subject: staffAccessNoticeEmailSubject,
  Component: StaffAccessNoticeEmail,
  fixtures: {
    "agent enrolled": {
      headline: "An operator enrolled an agent for staff access",
      operatorName: "Ada Operator",
      details: [
        { label: "Agent", value: "support laptop" },
        { label: "Expires", value: "2026-12-01T09:00:00.000Z" },
      ],
    },
    "request approved": {
      headline: "An operator approved staff access",
      operatorName: "Ada Operator",
      details: [
        { label: "Organization", value: "ACME" },
        { label: "Scopes", value: "org:metadata, org:support" },
        { label: "Reason", value: "Customer report: traces missing since Monday" },
        { label: "Machine", value: "support laptop" },
        { label: "Runs that spend allowed", value: "No" },
      ],
    },
  },
});

/** Rendered by the staff access module, which sends one copy to each other operator. */
export const renderStaffAccessNoticeEmail = async (
  props: StaffAccessNoticeEmailProps,
): Promise<{ subject: string; html: string }> => {
  const { subject, html } = await renderMailTemplate(staffAccessNoticeEmailTemplate, props);
  return { subject, html };
};
