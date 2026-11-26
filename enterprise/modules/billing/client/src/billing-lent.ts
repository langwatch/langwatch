import { uiTokens } from "@langwatch/module";

/** What billing lends to screens it does not own: a core screen renders it directly (§11). */

/** The "need more?" card. It reads the plan itself and takes nothing. */
export type ContactSalesProps = Record<string, never>;

/** A seat change waiting in licensing's upgrade dialog; billing prices and confirms it. */
export type SeatProrationPreviewProps = {
  variant: {
    organizationId: string;
    currentSeats: number;
    newSeats: number;
    /** `quotedAt` is the instant the quote on screen was priced, when one loaded. */
    onConfirm: (quotedAt?: number) => Promise<void>;
  };
  open: boolean;
  onClose: () => void;
};

/** What ops' license drawer hands the Billing section of a linked license. */
export type LicenseBillingSectionProps = {
  organizationId: string;
  organizationName: string;
  email: string;
  issuedAt: string;
  expiresAt: string;
  maxMembers: number;
  seatRateCents: number | null;
  seatCurrency: "USD" | "EUR" | null;
  commitUsdCents: number;
  /** Told once the section knows: no billing account means the license is a trial. */
  onBillingState?: (state: "trial" | "billed") => void;
  /**
   * Signs the license to the paid term's end before billing starts or renews, so
   * billing dates follow the license. False when licensing refused; nothing is billed then.
   */
  signPaidTerm?: (input: { expiresAt: string }) => Promise<boolean>;
};

/** What one more full seat costs, as billing's seat offer answers it. */
export type SeatRoleOfferKind = "none" | "charge" | "checkout" | "blocked" | "support";

/** Where the role change the offer sits under stands; the owner of the change decides. */
export type SeatRoleOfferState = "offer" | "busy" | "done" | "stuck";

/** The seat a role change needs, under the role field: specs/licensing/role-change-seat.feature */
export type SeatRoleOfferProps = {
  organizationId: string;
  organizationName: string;
  memberName: string;
  roleLabel: string;
  currentRoleLabel: string;
  state: SeatRoleOfferState;
  /** `quotedAt` is the instant the price on screen was quoted, when it was a charge. */
  onConfirm: (quotedAt?: number) => void;
  onKind?: (kind: SeatRoleOfferKind) => void;
  /** Today's amount of a charge offer, for the owner's own success message. */
  onAmountDue?: (formattedAmountDue: string) => void;
};

/** The organization a page is about; the banner reads the case and the reader's grants itself. */
export type PaymentRecoveryBannerProps = {
  organizationId: string;
  organizationName: string;
};

/** The failed payment banner and paused notice the shell draws above every page. */
export const PaymentRecoveryBannerToken =
  uiTokens("billing").component<PaymentRecoveryBannerProps>("paymentRecoveryBanner");

export const LicenseBillingSectionToken =
  uiTokens("billing").component<LicenseBillingSectionProps>("licenseBillingSection");
export const ContactSalesToken = uiTokens("billing").component<ContactSalesProps>("contactSales");
export const SeatRoleOfferToken =
  uiTokens("billing").component<SeatRoleOfferProps>("seatRoleOffer");
export const SeatProrationPreviewToken =
  uiTokens("billing").component<SeatProrationPreviewProps>("seatProrationPreview");
