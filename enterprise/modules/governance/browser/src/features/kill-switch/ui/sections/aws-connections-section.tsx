// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Field, HStack, Input, Text, VStack, Button } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import {
  type AwsConnectionView,
  awsConnectionInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "../../behavior/use-kill-switch.ts";

type Credential = "keys" | "role";

const EMPTY_FORM = {
  name: "",
  accessKeyId: "",
  secretAccessKey: "",
  roleArn: "",
  externalId: "",
};

/** How a connection signs in, as its row says it. Never the secret. */
function connectionDetail(connection: AwsConnectionView): string {
  const parts: string[] = [];
  if (connection.accessKeyIdLastFour) parts.push(`Key ending ${connection.accessKeyIdLastFour}`);
  if (connection.roleArn) parts.push(`Role ${connection.roleArn}`);
  if (connection.hasExternalId) parts.push("external id set");
  return parts.join(" · ");
}

/** The AWS connections a Bedrock target signs with: list, add and delete. */
export function AwsConnectionsSection({
  organizationId,
  connections,
}: {
  organizationId: string;
  connections: readonly AwsConnectionView[];
}) {
  const [adding, setAdding] = useState(false);
  const [credential, setCredential] = useState<Credential>("keys");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const create = api.governanceKillSwitch.createAwsConnection.useMutation();
  const remove = api.governanceKillSwitch.deleteAwsConnection.useMutation();

  const set = (field: keyof typeof EMPTY_FORM) => (event: { target: { value: string } }) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
    setFormError(null);
  };

  const submit = async () => {
    const optional = (value: string) => (value.trim() ? value.trim() : undefined);
    const parsed = awsConnectionInputSchema.safeParse(
      credential === "keys"
        ? {
            name: form.name,
            accessKeyId: optional(form.accessKeyId),
            secretAccessKey: optional(form.secretAccessKey),
          }
        : {
            name: form.name,
            roleArn: optional(form.roleArn),
            externalId: optional(form.externalId),
          },
    );
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the connection's fields.");
      return;
    }
    try {
      await create.mutateAsync({ organizationId, connection: parsed.data });
      toaster.create({ title: "AWS connection added", type: "success" });
      await refresh.afterConnectionChange();
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't add the AWS connection" });
    }
  };

  const deleteConnection = async (connection: AwsConnectionView) => {
    try {
      await remove.mutateAsync({ organizationId, connectionId: connection.id });
      toaster.create({ title: `Deleted ${connection.name}`, type: "success" });
      await refresh.afterConnectionChange();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't delete the AWS connection" });
    }
  };

  return (
    <VStack align="stretch" gap={3} data-testid="aws-connections">
      <HStack justify="space-between">
        <Text textStyle="sm" fontWeight="semibold">
          AWS connections
        </Text>
        {!adding && (
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add connection
          </Button>
        )}
      </HStack>
      {connections.length === 0 && !adding ? (
        <Text textStyle="sm" color="fg.muted">
          A Bedrock target needs an AWS connection to sign its calls.
        </Text>
      ) : null}
      {connections.map((connection) => (
        <HStack key={connection.id} justify="space-between" data-testid="aws-connection-row">
          <VStack align="start" gap={0}>
            <Text textStyle="sm">{connection.name}</Text>
            <Text textStyle="xs" color="fg.muted">
              {connectionDetail(connection)}
            </Text>
          </VStack>
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            aria-label={`Delete ${connection.name}`}
            loading={remove.isPending && remove.variables?.connectionId === connection.id}
            onClick={() => void deleteConnection(connection)}
          >
            <Trash2 size={14} />
          </Button>
        </HStack>
      ))}
      {adding && (
        <VStack align="stretch" gap={3} data-testid="aws-connection-form">
          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input aria-label="Connection name" value={form.name} onChange={set("name")} />
          </Field.Root>
          <SegmentedControl
            size="sm"
            aria-label="How it signs in"
            value={credential}
            onValueChange={({ value }) => {
              setCredential(value === "role" ? "role" : "keys");
              setFormError(null);
            }}
            items={[
              { value: "keys", label: "Access key" },
              { value: "role", label: "Role to assume" },
            ]}
          />
          {credential === "keys" ? (
            <>
              <Field.Root required>
                <Field.Label>Access key id</Field.Label>
                <Input
                  aria-label="Access key id"
                  value={form.accessKeyId}
                  onChange={set("accessKeyId")}
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>Secret access key</Field.Label>
                <Input
                  aria-label="Secret access key"
                  type="password"
                  autoComplete="off"
                  value={form.secretAccessKey}
                  onChange={set("secretAccessKey")}
                />
                <Field.HelperText>Stored encrypted and never shown again.</Field.HelperText>
              </Field.Root>
            </>
          ) : (
            <>
              <Field.Root required>
                <Field.Label>Role ARN</Field.Label>
                <Input
                  aria-label="Role ARN"
                  placeholder="arn:aws:iam::123456789012:role/langwatch-kill-switch"
                  value={form.roleArn}
                  onChange={set("roleArn")}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>External id</Field.Label>
                <Input
                  aria-label="External id"
                  value={form.externalId}
                  onChange={set("externalId")}
                />
              </Field.Root>
            </>
          )}
          {formError ? (
            <Text textStyle="sm" color="fg.error" role="alert">
              {formError}
            </Text>
          ) : null}
          <HStack justify="end" gap={2}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setForm(EMPTY_FORM);
                setFormError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={create.isPending}
              onClick={() => void submit()}
            >
              Add connection
            </Button>
          </HStack>
        </VStack>
      )}
    </VStack>
  );
}
