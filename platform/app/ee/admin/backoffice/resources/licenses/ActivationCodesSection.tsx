import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { api, type RouterOutputs } from "~/utils/api";
import { EmptyCell, formatDate } from "../../BackofficeTable";
import { IssueActivationCodeDrawer } from "./IssueActivationCodeDrawer";

type ActivationCode =
  RouterOutputs["licenseRegistry"]["activationCodes"]["codes"][number];

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<ActivationCode["status"], string> = {
  active: "green",
  redeemed: "gray",
  expired: "orange",
  revoked: "red",
};

/**
 * Activation codes, under the licenses they mint.
 *
 * Same screen as licenses because it is the same commercial act: a code is a
 * license the customer has not fetched yet. The code itself appears once, in
 * the drawer that issued it, and is never readable again: the row holds a hash
 * and the last four characters, which is enough to tell two codes apart and not
 * enough to redeem either.
 */
export function ActivationCodesSection() {
  const [issuing, setIssuing] = useState(false);
  const list = api.licenseRegistry.activationCodes.useQuery({
    page: 0,
    pageSize: PAGE_SIZE,
  });
  const revoke = api.licenseRegistry.revokeActivationCode.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "Activation code revoked",
        type: "success",
        duration: 3000,
      });
      void list.refetch();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "The activation code was not revoked",
      }),
  });

  const codes = list.data?.codes ?? [];

  return (
    <VStack gap={4} width="full" align="start">
      <HStack width="full">
        <Heading size="md">Activation codes</Heading>
        <Spacer />
        <Button size="sm" variant="outline" onClick={() => setIssuing(true)}>
          <Plus size={16} />
          New activation code
        </Button>
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          {list.error ? (
            <Box paddingY={10} paddingX={4}>
              <HandledErrorAlert
                error={list.error}
                fallbackTitle="Couldn't load activation codes"
              />
            </Box>
          ) : (
            <Table.Root variant="line" size="md">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Customer</Table.ColumnHeader>
                  <Table.ColumnHeader>Code</Table.ColumnHeader>
                  <Table.ColumnHeader>Plan</Table.ColumnHeader>
                  <Table.ColumnHeader>Seats</Table.ColumnHeader>
                  <Table.ColumnHeader>Code expires</Table.ColumnHeader>
                  <Table.ColumnHeader>Use</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader width="1%" />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {codes.length === 0 && !list.isLoading ? (
                  <Table.Row>
                    <Table.Cell colSpan={8}>
                      <Text color="fg.muted" fontSize="sm">
                        No activation codes issued yet.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ) : null}
                {codes.map((code) => (
                  <Table.Row key={code.id}>
                    <Table.Cell>
                      <VStack align="start" gap={0}>
                        <Text fontWeight="medium">{code.organizationName}</Text>
                        <Text fontSize="xs" color="fg.muted">
                          {code.email}
                        </Text>
                      </VStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontFamily="mono" fontSize="sm">
                        ...{code.codeHint}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{code.planType}</Table.Cell>
                    <Table.Cell>{code.maxMembers}</Table.Cell>
                    <Table.Cell>{formatDate(code.expiresAt)}</Table.Cell>
                    <Table.Cell>
                      {code.reusable ? (
                        <Text fontSize="sm">
                          reusable, {code.redemptionCount} so far
                        </Text>
                      ) : (
                        <EmptyCell>single use</EmptyCell>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Badge colorPalette={STATUS_COLORS[code.status]}>
                        {code.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {code.status === "active" ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          color="fg.error"
                          loading={revoke.isPending}
                          onClick={() => revoke.mutate({ id: code.id })}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Card.Body>
      </Card.Root>

      <IssueActivationCodeDrawer
        open={issuing}
        onClose={() => {
          setIssuing(false);
          void list.refetch();
        }}
      />
    </VStack>
  );
}
