import { BILLING_ONLY_SEAT, type InviteSeat } from "./member-invite-form.ts";
import { OrganizationUserRole } from "./prisma-types.ts";

/**
 * What the invite form says on Free, where there are no Lite seats: each seat's line in the
 * picker, and the way out for whoever pays (specs/licensing/billing-only-invite.feature).
 */
export type FreePlanInvite = {
  membersUsed?: number;
  membersMax?: number;
  organizationName: string;
  /** Growth's monthly price for one full seat, formatted; absent while it is not known. */
  growthSeatPrice?: string;
};

/** The picker's line per seat on Free, in place of the usual descriptions. */
export function freePlanSeatDescriptions({
  membersUsed,
  membersMax,
}: Pick<FreePlanInvite, "membersUsed" | "membersMax">): Partial<Record<InviteSeat, string>> {
  return {
    ...(membersUsed !== undefined && membersMax !== undefined
      ? { [OrganizationUserRole.MEMBER]: `${membersUsed} of ${membersMax} used on Free` }
      : {}),
    [OrganizationUserRole.EXTERNAL]: "Not on Free",
    [BILLING_ONLY_SEAT]: "Pays for LangWatch: plan, invoices, upgrade",
  };
}

/** Why Lite does not fit on Free, naming the one person invited when there is one. */
export function liteNotOnFreeText({
  emails,
  organizationName,
}: {
  emails: readonly string[];
  organizationName: string;
}): string {
  const who = emails.length === 1 ? emails[0] : "the person you are inviting";
  return `If ${who} pays for LangWatch, invite them as Billing only. It takes no seat, shows the plan and invoices, and lets them upgrade ${organizationName}.`;
}

/** The line about Growth under the choices, with the seat price once it is known. */
export function growthLiteLine(growthSeatPrice?: string): string {
  return growthSeatPrice
    ? `Growth has unlimited Lite members, from ${growthSeatPrice}/mo per full seat.`
    : "Growth has unlimited Lite members.";
}
