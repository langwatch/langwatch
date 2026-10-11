import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Button, HStack, Input, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { HandledErrorAlert } from "@langwatch/error-views";
import type { OpsPlatformOperator } from "@langwatch/ops-contract";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
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
    return <SkeletonRows rows={6} />;
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
            required
            onChange={(event) => setEmail(event.target.value)}
            maxWidth="420px"
          />
          <Button type="submit" colorPalette="accent" size="sm" loading={grant.isPending}>
            Grant
          </Button>
        </HStack>
      </form>

      <ListTable density="compact" scroll="x" scrollLabel="Platform operators">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Email</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Operator since</ListTable.ColumnHeader>
            <ListTable.ColumnHeader width="fit" label="Actions" />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {operators.length === 0 ? (
            <ListTable.SpanRow columns={4}>
              <NoDataInfoBlock
                icon={<ShieldCheck />}
                title="No platform operators."
                description="Grant operator access to an existing user by email."
              />
            </ListTable.SpanRow>
          ) : null}
          {operators.map((operator) => (
            <ListTable.Row key={operator.grantId}>
              <ListTable.Cell>{operator.name ?? "—"}</ListTable.Cell>
              <ListTable.Cell>{operator.email ?? operator.userId}</ListTable.Cell>
              <ListTable.Cell>{formatDateTime(operator.grantedAt)}</ListTable.Cell>
              <ListTable.Cell>
                <Button size="sm" variant="outline" onClick={() => setRevoking(operator)}>
                  Revoke
                </Button>
              </ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate({ grantId: revoking.grantId });
        }}
        title={`Revoke ${revoking?.email ?? "this operator"}`}
        description="They lose every operator page and action at once. An installation always keeps at least one operator."
        loading={revoke.isPending}
      />
    </VStack>
  );
}
