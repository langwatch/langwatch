import type { SeatPayment } from "@langwatch/enterprise-billing-contract";
import type { OrganizationUserRole } from "@langwatch/organization-contract";

const ROLE_LABELS: Record<OrganizationUserRole, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  EXTERNAL: "Lite Member",
  DEVELOPER: "Developer",
};

/** The role as the members page names it. */
export function roleLabel(role: OrganizationUserRole): string {
  return ROLE_LABELS[role];
}

/** A payment as a fact names it: the invoice or the checkout row, without its seat count. */
export type SeatPaymentRef =
  | Pick<Extract<SeatPayment, { kind: "invoice" }>, "kind" | "invoiceId">
  | Extract<SeatPayment, { kind: "checkout" }>;

/** The one key a payment is found by, whatever kind it is. */
export function paymentKey(payment: SeatPaymentRef): string {
  return payment.kind === "invoice"
    ? `invoice:${payment.invoiceId}`
    : `checkout:${payment.subscriptionId}`;
}

/** The member's drawer a seat checkout returns to; it resumes the change waiting there. */
export function seatRoleChangeReturnPath(userId: string): string {
  const user = encodeURIComponent(userId);
  return `/settings/directory?tab=people&drawer.open=person&drawer.userId=${user}`;
}
