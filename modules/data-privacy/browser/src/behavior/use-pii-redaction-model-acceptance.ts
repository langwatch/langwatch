/**
 * The organization's acceptance of the PII Redaction Model's price: the snapshot's word, or an
 * acceptance given on this page, shown at once since an acceptance is never withdrawn (ADR-201).
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
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
  host,
  onAccepted,
}: {
  snapshot: DataPrivacySnapshot | undefined;
  host: DataPrivacyHostApi;
  onAccepted: () => void;
}): PiiRedactionModelAcceptanceState {
  const acceptPrice = dataPrivacyApi.dataPrivacy.acceptPiiRedactionModel.useMutation();
  const [acceptedHere, setAcceptedHere] = useState(false);
  return {
    accepted: snapshot?.piiRedactionModelAccepted === true || acceptedHere,
    accept: async ({ organizationId }) => {
      try {
        await acceptPrice.mutateAsync({ organizationId });
      } catch (error) {
        host.failed({ error, fallbackTitle: "Couldn't accept the PII Redaction Model's price" });
        return false;
      }
      setAcceptedHere(true);
      onAccepted();
      return true;
    },
  };
}
