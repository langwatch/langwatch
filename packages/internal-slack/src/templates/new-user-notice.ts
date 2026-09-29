import { z } from "zod";

import { defineNotice, type NoticeField } from "../notice.ts";

const newUserSchema = z.object({
  userName: z.string().nullish(),
  userEmail: z.string().nullish(),
  organizationName: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  utmCampaign: z.string().nullish(),
  adminUrl: z.url().nullish(),
});

export type NewUserNoticeProps = z.input<typeof newUserSchema>;

export const newUserNotice = defineNotice({
  id: "new-user",
  title: "New user registered",
  sentWhen:
    "Somebody signs up, accepts an invitation or joins through their domain; to the signups channel.",
  schema: newUserSchema,
  compose: (props) => {
    const fields: NoticeField[] = [
      { label: "Name", value: props.userName ?? "Unknown" },
      { label: "Email", value: props.userEmail ?? "unknown" },
      { label: "Organization", value: props.organizationName ?? "Unknown" },
    ];
    if (props.phoneNumber) fields.push({ label: "Phone", value: props.phoneNumber });
    if (props.utmCampaign) fields.push({ label: "Campaign", value: props.utmCampaign });
    return {
      tone: "signup",
      title: "New user registered",
      fields,
      ...(props.adminUrl ? { actions: [{ label: "Open org in admin", url: props.adminUrl }] } : {}),
    };
  },
  fixtures: {
    "from a campaign": {
      userName: "Morgan Ellis",
      userEmail: "morgan@acme.example",
      organizationName: "Acme Robotics",
      phoneNumber: "+31 20 555 0100",
      utmCampaign: "launch-week",
      adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
    },
    "with only an email": {
      userEmail: "morgan@acme.example",
    },
  },
});
