import { useCallback, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { type TermsForm, termsFormFrom } from "./terms";

export type IssueMode = "issue" | "register";
export type CustomerMode = "existing" | "new";
export type PlanType = "GROWTH" | "PRO" | "ENTERPRISE" | "CUSTOM";

export interface IssueForm {
  mode: IssueMode;
  customerMode: CustomerMode;
  organizationId: string;
  newOrganizationName: string;
  email: string;
  planType: PlanType;
  maxMembers: string;
  maxMembersLite: string;
  expiresAt: string;
  terms: TermsForm;
  licenseKey: string;
}

export type SetIssueField = <K extends keyof IssueForm>(
  key: K,
  value: IssueForm[K],
) => void;

function emptyIssueForm(): IssueForm {
  return {
    mode: "issue",
    customerMode: "existing",
    organizationId: "",
    newOrganizationName: "",
    email: "",
    planType: "ENTERPRISE",
    maxMembers: "10",
    maxMembersLite: "",
    expiresAt: "",
    terms: termsFormFrom(null),
    licenseKey: "",
  };
}

export function useIssueForm() {
  const [form, setForm] = useState<IssueForm>(emptyIssueForm);
  const set = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  // The drawer stays mounted between openings, so it is this that decides
  // what the operator sees on the next one rather than the unmount.
  const reset = useCallback(() => setForm(emptyIssueForm()), []);
  return { form, set, reset };
}

/** Issue a freshly signed license, or register one issued before the registry. */
export function useIssueCommands({
  onIssued,
  onRegistered,
}: {
  onIssued: (licenseKey: string) => void;
  onRegistered: () => void;
}) {
  const utils = api.useContext();
  const done = async (title: string) => {
    await utils.licenseRegistry.invalidate();
    toaster.create({ title, type: "success", duration: 3000 });
  };
  const issue = api.licenseRegistry.issue.useMutation({
    onSuccess: async (result) => {
      onIssued(result.licenseKey);
      await done("License issued");
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "The license was not issued" }),
  });
  const register = api.licenseRegistry.registerLegacy.useMutation({
    onSuccess: async () => {
      await done("License registered");
      onRegistered();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "The license was not registered",
      }),
  });
  return { issue, register };
}
