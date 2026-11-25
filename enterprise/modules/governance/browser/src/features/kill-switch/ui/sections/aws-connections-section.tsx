// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { AwsConnectionView } from "@langwatch/enterprise-governance-contract";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
import { useKillSwitchRefresh } from "../../behavior/use-kill-switch.ts";
import { AwsConnectionForm } from "./aws-connection-form.tsx";

/** How a connection signs in, as its row says it. Never the secret. */
function connectionDetail(connection: AwsConnectionView): string {
  const parts: string[] = [];
  if (connection.accessKeyIdLastFour) parts.push(`Key ending ${connection.accessKeyIdLastFour}`);
  if (connection.roleArn) parts.push(`Role ${connection.roleArn}`);
  if (connection.externalId) parts.push(`External id ${connection.externalId}`);
  return parts.join(" · ");
}

function ConnectionRow({
  connection,
  isDeleting,
  onDelete,
}: {
  connection: AwsConnectionView;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  return (
    <HStack justify="space-between" data-testid="aws-connection-row">
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
        loading={isDeleting}
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </Button>
    </HStack>
  );
}

/**
 * The AWS connections a Bedrock target signs with: list, add and delete. A delete refused because
 * a plan or an open stop still signs with the connection shows the refusal's own words.
 */
export function AwsConnectionsSection({
  organizationId,
  connections,
}: {
  organizationId: string;
  connections: readonly AwsConnectionView[];
}) {
  const [adding, setAdding] = useState(false);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const refresh = useKillSwitchRefresh({ organizationId });
  const remove = api.governanceKillSwitch.deleteAwsConnection.useMutation();

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
        <ConnectionRow
          key={connection.id}
          connection={connection}
          isDeleting={remove.isPending && remove.variables?.connectionId === connection.id}
          onDelete={() => void deleteConnection(connection)}
        />
      ))}
      {adding && (
        <AwsConnectionForm organizationId={organizationId} onDone={() => setAdding(false)} />
      )}
    </VStack>
  );
}
