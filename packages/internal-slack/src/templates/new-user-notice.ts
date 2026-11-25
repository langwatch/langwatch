import { z } from "zod";

import { defineNotice } from "../notice.ts";
import { organizationInOps, userInOps } from "./ops-links.ts";

const newUserSchema = z.object({
  userId: z.string().min(1),
  userName: z.string().nullish(),
  userEmail: z.string().nullish(),
  organizationId: z.string().min(1),
  organizationName: z.string().nullish(),
  arrival: z.enum(["invitation", "sso", "scim"]),
  ssoProviderName: z.string().nullish(),
  appUrl: z.url(),
});

export type NewUserNoticeProps = z.input<typeof newUserSchema>;

const routeOf = (props: NewUserNoticeProps): string => {
  if (props.arrival === "invitation") return "via invitation";
  if (props.arrival === "scim") return "via SCIM";
  return props.ssoProviderName ? `via SSO (${props.ssoProviderName})` : "via SSO";
};

export const newUserNotice = defineNotice({
  id: "new-user",
  title: "New user joined an organisation",
  sentWhen:
    "Somebody joins an existing organisation by invitation, SSO or SCIM; to the signups channel.",
  schema: newUserSchema,
  compose: (props) => {
    const via = routeOf(props);
    const who = props.userName || props.userEmail || "Somebody";
    return {
      kind: "card",
      tone: "signup",
      title: `${who} joined ${props.organizationName || "an organisation"}`,
      subtitle: [props.userEmail, via].filter(Boolean).join(" · "),
      actions: [
        userInOps({ appUrl: props.appUrl, userId: props.userId }),
        organizationInOps({ appUrl: props.appUrl, organizationId: props.organizationId }),
      ],
    };
  },
  fixtures: {
    "joined by invitation": {
      userId: "user_riley",
      userName: "Riley Chen",
      userEmail: "riley.chen@acme.example",
      organizationId: "organization_acme",
      organizationName: "Acme Robotics",
      arrival: "invitation",
      appUrl: "https://app.langwatch.ai",
    },
    "joined through SSO": {
      userId: "user_riley",
      userName: "Riley Chen",
      userEmail: "riley.chen@acme.example",
      organizationId: "organization_acme",
      organizationName: "Acme Robotics",
      arrival: "sso",
      ssoProviderName: "Okta",
      appUrl: "https://app.langwatch.ai",
    },
    "with only an id": {
      userId: "user_riley",
      organizationId: "organization_acme",
      arrival: "scim",
      appUrl: "https://app.langwatch.ai",
    },
  },
});
