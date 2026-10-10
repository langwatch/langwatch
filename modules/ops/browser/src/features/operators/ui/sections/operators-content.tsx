import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Button,
  Center,
  HStack,
  Input,
  Spinner,
  Table,
  VStack,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { OpsPlatformOperator } from "@langwatch/ops-contract";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";
import { formatDateTime } from "../../../admin/ui/elements/admin-cells.tsx";

/**
 * Who operates this installation: list, grant by address, revoke. authz refuses granting
 * yourself and revoking the last holder; those refusals arrive as toasts with their copy.
 */
export function OperatorsContent() {
  const showErrorToast = useShowErrorToast();
  const [email, setEmail] = useState("");
  const [revoking, setRevoking] = useState<OpsPlatformOperator | null>(null);
  const utils = api.useUtils();
  const list = api.ops.listPlatformOperators.useQuery();
  const grant = api.ops.grantPlatformOperator.useMutation({
    onSuccess: async () => {
      setEmail("");
      await utils.ops.listPlatformOperators.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't grant the role" }),
  });
  const revoke = api.ops.revokePlatformOperator.useMutation({
    onSuccess: async () => {
      setRevoking(null);
      await utils.ops.listPlatformOperators.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't revoke the role" }),
  });

  if (list.isLoading) {
    return (
      <Center paddingY={20}>
        <Spinner />
      </Center>
    );
  }
  if (list.error) {
    return <HandledErrorAlert error={list.error} fallbackTitle="Couldn't load the operators" />;
  }

  const operators = list.data ?? [];
  return (
    <VStack align="stretch" gap={6}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) grant.mutate({ email: email.trim() });
        }}
      >
        <HStack gap={3} wrap="wrap">
          <Input
            size="sm"
            type="email"
            aria-label="Email address of an existing user"
            placeholder="Email address of an existing user"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxWidth="420px"
          />
          <Button
            type="submit"
            colorPalette="accent"
            size="sm"
            loading={grant.isPending}
            disabled={!email.trim()}
          >
            Grant
          </Button>
        </HStack>
      </form>

      <ListTable
        density="compact"
        columnRules={false}
        containerProps={{ overflowX: "auto" }}
        variant="line"
        size="sm"
      >
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Name</Table.ColumnHeader>
            <Table.ColumnHeader>Email</Table.ColumnHeader>
            <Table.ColumnHeader>Operator since</Table.ColumnHeader>
            <Table.ColumnHeader width="1%" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {operators.map((operator) => (
            <Table.Row key={operator.grantId}>
              <Table.Cell>{operator.name ?? "—"}</Table.Cell>
              <Table.Cell>{operator.email ?? operator.userId}</Table.Cell>
              <Table.Cell>{formatDateTime(operator.grantedAt)}</Table.Cell>
              <Table.Cell>
                <Button size="sm" variant="outline" onClick={() => setRevoking(operator)}>
                  Revoke
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </ListTable>
      {operators.length === 0 ? (
        <NoDataInfoBlock
          icon={<ShieldCheck />}
          title="No platform operators."
          description="Grant operator access to an existing user by email."
        />
      ) : null}

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate({ grantId: revoking.grantId });
        }}
        title={`Revoke ${revoking?.email ?? "this operator"}`}
        description="They lose every operator page and action at once. An installation always keeps at least one operator."
        isLoading={revoke.isPending}
      />
    </VStack>
  );
}
