import { z } from "zod";

import { defineNotice } from "../notice.ts";
import { organizationInOps, userInOps } from "./ops-links.ts";

const newOrganizationSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().nullish(),
  userEmail: z.string().nullish(),
  organizationId: z.string().min(1),
  organizationName: z.string().nullish(),
  phoneNumber: z.string().nullish(),
  utmCampaign: z.string().nullish(),
  appUrl: z.url(),
});

export type NewOrganizationNoticeProps = z.input<typeof newOrganizationSchema>;

export const newOrganizationNotice = defineNotice({
  id: "new-organization",
  title: "New organisation created",
  sentWhen: "Somebody finishes onboarding and creates an organisation; to the signups channel.",
  schema: newOrganizationSchema,
  compose: (props) => {
    const body = [
      props.utmCampaign ? `Campaign ${props.utmCampaign}` : undefined,
      props.phoneNumber,
    ].filter(Boolean);
    return {
      kind: "card",
      tone: "organization",
      title: `${props.organizationName || "An organisation"} · new organisation`,
      subtitle: [props.userName, props.userEmail].filter(Boolean).join(" · ") || "Unknown user",
      ...(body.length > 0 ? { body: body.join(" · ") } : {}),
      actions: [
        userInOps({ appUrl: props.appUrl, userId: props.userId }),
        organizationInOps({ appUrl: props.appUrl, organizationId: props.organizationId }),
      ],
    };
  },
  fixtures: {
    "from a campaign": {
      userId: "user_morgan",
      userName: "Morgan Ellis",
      userEmail: "morgan.ellis@acme.example",
      organizationId: "organization_acme",
      organizationName: "Acme Robotics",
      phoneNumber: "+31 20 555 0100",
      utmCampaign: "launch-week",
      appUrl: "https://app.langwatch.ai",
    },
    "with only an email": {
      userId: "user_morgan",
      userEmail: "morgan.ellis@acme.example",
      organizationId: "organization_acme",
      appUrl: "https://app.langwatch.ai",
    },
  },
});
