import { z } from "zod";

import { count, defineNotice, type NoticeLayout } from "../notice.ts";

const limitSchema = z.object({
  organizationName: z.string(),
  adminName: z.string().nullish(),
  adminEmail: z.string().nullish(),
  planName: z.string(),
  limitType: z.string().describe("The cap that was hit, as people call it"),
  current: z.number(),
  max: z.number(),
  adminUrl: z.url(),
});

const limitLayout = ({
  title,
  props,
}: {
  title: string;
  props: z.output<typeof limitSchema>;
}): NoticeLayout => ({
  tone: "warning",
  title,
  fields: [
    { label: "Organization", value: props.organizationName },
    { label: "Admin", value: props.adminEmail ?? "unknown" },
    { label: "Plan", value: props.planName },
    { label: props.limitType, value: `${count(props.current)}/${count(props.max)}` },
  ],
  actions: [{ label: "Open org in admin", url: props.adminUrl, primary: true }],
});

const fixture = {
  organizationName: "Acme Robotics",
  adminName: "Morgan Ellis",
  adminEmail: "morgan@acme.example",
  planName: "Free",
  adminUrl: "https://app.langwatch.ai/admin#/organizations/organization_acme",
};

export const planLimitReachedNotice = defineNotice({
  id: "plan-limit-reached",
  title: "Plan limit reached",
  sentWhen: "An organization hits its plan's monthly usage cap; to the plan-limit channel.",
  schema: limitSchema,
  compose: (props) => limitLayout({ title: "Plan limit reached", props }),
  fixtures: {
    "monthly traces": { ...fixture, limitType: "Monthly Traces", current: 50_000, max: 50_000 },
  },
});

export const resourceLimitReachedNotice = defineNotice({
  id: "resource-limit-reached",
  title: "Resource limit reached",
  sentWhen:
    "An organization hits a resource cap such as seats or projects; to the plan-limit channel.",
  schema: limitSchema,
  compose: (props) => limitLayout({ title: "Resource limit reached", props }),
  fixtures: {
    "team members": { ...fixture, limitType: "members", current: 2, max: 2 },
    "no admin on record": {
      ...fixture,
      adminName: null,
      adminEmail: null,
      limitType: "projects",
      current: 3,
      max: 3,
    },
  },
});
