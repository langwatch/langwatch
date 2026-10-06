/** What billing lends to screens it does not own: a core screen renders it directly (§11). */

import { uiTokens } from "@langwatch/module";

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

export const ContactSalesToken = uiTokens("billing").component<ContactSalesProps>("contactSales");
export const SeatProrationPreviewToken =
  uiTokens("billing").component<SeatProrationPreviewProps>("seatProrationPreview");
