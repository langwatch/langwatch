import { Box, Button, Card, Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { HandledErrorAlert } from "../../../../ui/elements/ops-handled-error-alert.tsx";
import { useActivationCodeCommands } from "../../behavior/use-activation-code-commands.ts";
import { ActivationCodesTable } from "../blocks/activation-codes-table.tsx";
import { IssueActivationCodeDrawer } from "./issue-activation-code-drawer.tsx";

const PAGE_SIZE = 25;

/** Activation codes, under the licenses they mint (ADR-156 §5): a code is a
 * license the customer has not fetched yet. Shown once, on issue, never
 * readable again — the row holds only a hash and a hint. */
export function ActivationCodesSection() {
  const [issuing, setIssuing] = useState(false);
  const list = api.licenseRegistry.activationCodes.useQuery({ page: 0, pageSize: PAGE_SIZE });
  const commands = useActivationCodeCommands();

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
            <ActivationCodesTable
              codes={list.data?.codes ?? []}
              isLoading={list.isLoading}
              isRevoking={commands.revoke.isPending}
              onRevoke={(code) => commands.revoke.mutate({ id: code.id })}
            />
          )}
        </Card.Body>
      </Card.Root>

      <IssueActivationCodeDrawer open={issuing} onClose={() => setIssuing(false)} />
    </VStack>
  );
}
