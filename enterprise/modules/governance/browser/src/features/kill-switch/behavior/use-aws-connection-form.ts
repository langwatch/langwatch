// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A new AWS connection being typed: a key pair or a role to assume, checked against the contract
 * and then created. The secret goes out once and is never read back.
 */
import {
  awsConnectionInputSchema,
  type AwsConnectionView,
} from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "./use-kill-switch.ts";

export type Credential = "keys" | "role";

const EMPTY_FORM = {
  name: "",
  accessKeyId: "",
  secretAccessKey: "",
  roleArn: "",
};
export type ConnectionFields = typeof EMPTY_FORM;
export type ConnectionFieldBinding = {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
};

function connectionInput({ credential, form }: { credential: Credential; form: ConnectionFields }) {
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  return awsConnectionInputSchema.safeParse(
    credential === "keys"
      ? {
          name: form.name,
          accessKeyId: optional(form.accessKeyId),
          secretAccessKey: optional(form.secretAccessKey),
        }
      : { name: form.name, roleArn: optional(form.roleArn) },
  );
}

export function useAwsConnectionForm({
  organizationId,
  onDone,
}: {
  organizationId: string;
  /** Called with the new connection once it is saved, and with nothing on cancel. */
  onDone: (created?: AwsConnectionView) => void;
}) {
  const [credential, setCredential] = useState<Credential>("keys");
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const create = api.governanceKillSwitch.createAwsConnection.useMutation();

  const field = (name: keyof ConnectionFields): ConnectionFieldBinding => ({
    value: form[name],
    onChange: (event) => {
      setForm((previous) => ({ ...previous, [name]: event.target.value }));
      setError(null);
    },
  });

  const isSaving = create.isPending || submitting;
  /** Cancel stays shut until the create and its re-read finish, so `onDone` closes this form only. */
  const submit = async () => {
    if (isSaving) return;
    const parsed = connectionInput({ credential, form });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the connection's fields.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await create.mutateAsync({ organizationId, connection: parsed.data });
      toaster.create({ title: "AWS connection added", type: "success" });
      await refresh.afterConnectionChange();
      onDone(created);
    } catch (failure) {
      showErrorToast({ error: failure, fallbackTitle: "Couldn't add the AWS connection" });
    } finally {
      setSubmitting(false);
    }
  };

  const pickCredential = (value: string | null) => {
    setCredential(value === "role" ? "role" : "keys");
    setError(null);
  };

  return { credential, pickCredential, field, error, submit, isSaving };
}
