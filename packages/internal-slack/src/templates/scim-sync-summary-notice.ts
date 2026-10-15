import { z } from "zod";

import { count, defineNotice } from "../notice.ts";
import { organizationInOps } from "./ops-links.ts";

const NAMES_SHOWN = 3;

const scimSyncSummarySchema = z.object({
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  added: z.number().int().min(0),
  updated: z.number().int().min(0),
  deactivated: z.number().int().min(0),
  failed: z.number().int().min(0),
  addedNames: z.array(z.string()),
  appUrl: z.url(),
});

export type ScimSyncSummaryNoticeProps = z.input<typeof scimSyncSummarySchema>;

export const scimSyncSummaryNotice = defineNotice({
  id: "scim-sync-summary",
  title: "SCIM updated an organisation",
  sentWhen: "A burst of SCIM changes to an organisation's users settles; one summary per burst.",
  schema: scimSyncSummarySchema,
  compose: (props) => {
    const counts = (
      [
        [props.added, "added"],
        [props.updated, "updated"],
        [props.deactivated, "deactivated"],
        [props.failed, "failed"],
      ] as const
    )
      .filter(([value]) => value > 0)
      .map(([value, word]) => `${count(value)} ${word}`);
    const shown = props.addedNames.slice(0, NAMES_SHOWN);
    const more = props.added - shown.length;
    const names = shown.join(", ") + (more > 0 ? ` and ${count(more)} more` : "");
    return {
      kind: "card",
      tone: "directory",
      title: `SCIM updated ${props.organizationName}`,
      subtitle: counts.length > 0 ? counts.join(" · ") : "No changes",
      ...(shown.length > 0 ? { body: `Added: ${names}` } : {}),
      actions: [organizationInOps({ appUrl: props.appUrl, organizationId: props.organizationId })],
    };
  },
  fixtures: {
    "a large sync": {
      organizationId: "organization_acme",
      organizationName: "Acme Robotics",
      added: 42,
      updated: 3,
      deactivated: 2,
      failed: 1,
      addedNames: ["Riley Chen", "Morgan Ellis", "Sam Okafor", "Noa Bar"],
      appUrl: "https://app.langwatch.ai",
    },
    "only deactivations": {
      organizationId: "organization_acme",
      organizationName: "Acme Robotics",
      added: 0,
      updated: 0,
      deactivated: 2,
      failed: 0,
      addedNames: [],
      appUrl: "https://app.langwatch.ai",
    },
  },
});
