import { Card } from "@langwatch/design-system/card";
import { Box, Button, Heading, HStack, Spacer, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
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
        <Heading size="sm">Activation codes</Heading>
        <Spacer />
        <Button size="sm" variant="outline" onClick={() => setIssuing(true)}>
          <Plus size={16} />
          New activation code
        </Button>
      </HStack>

      <Card padding="none">
        {list.error ? (
          <Box paddingY={10} paddingX={4}>
            <HandledErrorAlert error={list.error} fallbackTitle="Couldn't load activation codes" />
          </Box>
        ) : (
          <ActivationCodesTable
            codes={list.data?.codes ?? []}
            isLoading={list.isLoading}
            isRevoking={commands.revoke.isPending}
            onRevoke={(code) => commands.revoke.mutate({ id: code.id })}
          />
        )}
      </Card>

      <IssueActivationCodeDrawer open={issuing} onClose={() => setIssuing(false)} />
    </VStack>
  );
}
