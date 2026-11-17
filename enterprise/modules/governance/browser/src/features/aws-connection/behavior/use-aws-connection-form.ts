// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A new AWS connection being typed: a key pair or a role to assume, checked against the contract
 * and then created. The secret goes out once and is never read back.
 */
import {
  type AwsConnectionView,
  awsConnectionInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { useRef, useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useAwsConnectionsRefresh } from "./use-aws-connections.ts";

export type Credential = "keys" | "role";

const EMPTY_FORM = {
  name: "",
  accessKeyId: "",
  secretAccessKey: "",
  roleArn: "",
  externalId: "",
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
      : { name: form.name, roleArn: optional(form.roleArn), externalId: optional(form.externalId) },
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
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useAwsConnectionsRefresh({ organizationId });
  const create = api.governanceKillSwitch.createAwsConnection.useMutation();
  // Held from the first click until the list refresh and onDone finish, so a second submit
  // cannot create a second connection and cancel cannot race a pending create.
  const inFlight = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const field = (name: keyof ConnectionFields): ConnectionFieldBinding => ({
    value: form[name],
    onChange: (event) => {
      setForm((previous) => ({ ...previous, [name]: event.target.value }));
      setError(null);
    },
  });

  const submit = async () => {
    if (inFlight.current) return;
    const parsed = connectionInput({ credential, form });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the connection's fields.");
      return;
    }
    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const created = await create.mutateAsync({ organizationId, connection: parsed.data });
      toaster.create({ title: "AWS connection added", type: "success" });
      await refresh.afterConnectionChange();
      onDone(created);
    } catch (failure) {
      showErrorToast({ error: failure, fallbackTitle: "Couldn't add the AWS connection" });
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const pickCredential = (value: string | null) => {
    setCredential(value === "role" ? "role" : "keys");
    setError(null);
  };

  return { credential, pickCredential, field, error, submit, isSaving: isSubmitting };
}
