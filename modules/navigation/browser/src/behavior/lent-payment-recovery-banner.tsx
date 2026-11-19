/** Billing's failed payment banner, drawn in the shell's banner stack (§10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  PaymentRecoveryBannerToken,
  type PaymentRecoveryBannerProps,
} from "@langwatch/enterprise-billing-client";

/** Nothing where billing is not installed, or while the organization pays on time. */
export function PaymentRecoveryBanner(props: PaymentRecoveryBannerProps) {
  return <Lent of={PaymentRecoveryBannerToken} props={props} />;
}
