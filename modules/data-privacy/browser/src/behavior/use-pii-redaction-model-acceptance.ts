/**
 * The organization's acceptance of the PII Redaction Model's price: the snapshot's word, or an
 * acceptance given on this page for the organization shown, at once since an acceptance is never
 * withdrawn (ADR-201). Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import type { DataPrivacySnapshot } from "@langwatch/data-privacy-contract";
import { useState } from "react";

import type { DataPrivacyHostApi } from "../model/data-privacy-host.ts";
import { dataPrivacyApi } from "./data-privacy-api.ts";

/** Records the acceptance: true once kept; a refusal is told through the host and is false. */
export type AcceptPiiRedactionModel = (input: { organizationId: string }) => Promise<boolean>;

export type PiiRedactionModelAcceptanceState = {
  accepted: boolean;
  accept: AcceptPiiRedactionModel;
};

export function usePiiRedactionModelAcceptance({
  snapshot,
  organizationId: shownOrganizationId,
  host,
  onAccepted,
}: {
  snapshot: DataPrivacySnapshot | undefined;
  /** The organization of the project shown; an acceptance given for another one does not count. */
  organizationId: string | null;
  host: DataPrivacyHostApi;
  onAccepted: () => void;
}): PiiRedactionModelAcceptanceState {
  const acceptPrice = dataPrivacyApi.dataPrivacy.acceptPiiRedactionModel.useMutation();
  const [acceptedHere, setAcceptedHere] = useState<ReadonlySet<string>>(() => new Set());
  const acceptedOnThisPage = shownOrganizationId !== null && acceptedHere.has(shownOrganizationId);
  return {
    accepted: snapshot?.piiRedactionModelAccepted === true || acceptedOnThisPage,
    accept: async ({ organizationId }) => {
      try {
        await acceptPrice.mutateAsync({ organizationId });
      } catch (error) {
        host.failed({ error, fallbackTitle: "Couldn't accept the PII Redaction Model's price" });
        return false;
      }
      setAcceptedHere((accepted) => new Set(accepted).add(organizationId));
      onAccepted();
      return true;
    },
  };
}
