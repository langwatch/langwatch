import { Card } from "@langwatch/design-system/card";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Box, Button, Heading, HStack, Spacer, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useTestingLicenseTokenCommands } from "../../behavior/use-testing-license-token-commands.ts";
import { tokenDisplayName, type TestingLicenseToken } from "../../model/testing-license-token.ts";
import { TestingLicenseTokensTable } from "../blocks/testing-license-tokens-table.tsx";
import { CreateServiceTokenDrawer } from "./create-service-token-drawer.tsx";

const PAGE_SIZE = 50;

/** Testing license tokens (ADR-180): what lets a developer's stack or a CI job ask Cloud for a
 * testing license. Any ops manager sees every token and may revoke it. */
export function TestingLicenseTokensSection() {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<TestingLicenseToken | null>(null);
  const list = api.licenseRegistry.testingLicenseTokens.useQuery({ page: 0, pageSize: PAGE_SIZE });
  const commands = useTestingLicenseTokenCommands();

  return (
    <VStack gap={4} width="full" align="start">
      <HStack width="full">
        <Heading size="sm">Testing license tokens</Heading>
        <Spacer />
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus size={16} />
          New service token
        </Button>
      </HStack>

      <Card padding="none">
        {list.error ? (
          <Box paddingY={10} paddingX={4}>
            <HandledErrorAlert
              error={list.error}
              fallbackTitle="Couldn't load testing license tokens"
            />
          </Box>
        ) : (
          <TestingLicenseTokensTable
            tokens={list.data?.tokens ?? []}
            isLoading={list.isLoading}
            onRevoke={setRevoking}
          />
        )}
      </Card>

      <CreateServiceTokenDrawer open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title={`Revoke ${revoking ? tokenDisplayName(revoking) : "token"}?`}
        description="Whatever uses this token can no longer ask for testing licenses. This cannot be undone."
        confirmLabel="Revoke token"
        loading={commands.revoke.isPending}
        onConfirm={() => {
          if (!revoking) return;
          commands.revoke.mutate({ id: revoking.id }, { onSettled: () => setRevoking(null) });
        }}
      />
    </VStack>
  );
}
