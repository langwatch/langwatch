/** Everything the passkey signature approves, laid out to read top to bottom before signing. */

import { Card } from "@langwatch/design-system/card";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { Box, Grid, HStack, Text } from "@langwatch/design-system/primitives";
import type { StaffAccessApprovalView } from "@langwatch/staff-access-contract";
import type { ReactNode } from "react";

import { ScopeList } from "../elements/scope-list.tsx";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Text textStyle="bodySm" color="fg.muted">
        {label}
      </Text>
      <Box minWidth={0}>{children}</Box>
    </>
  );
}

export function RequestDetails({
  view,
  expiry,
}: {
  view: Pick<
    StaffAccessApprovalView,
    | "organizationId"
    | "organizationName"
    | "scopes"
    | "reason"
    | "machine"
    | "requestIp"
    | "requesterName"
  >;
  /** The countdown while pending, or the request's outcome once decided. */
  expiry: ReactNode;
}) {
  return (
    <Card padding="lg">
      <Grid templateColumns={{ base: "1fr", md: "140px minmax(0, 1fr)" }} columnGap={6} rowGap={4}>
        <Fact label="Organization">
          {view.organizationId ? (
            <HStack gap={2} wrap="wrap">
              <Text fontWeight="semibold" data-testid="staff-access-organization-name">
                {view.organizationName ?? "Unnamed organization"}
              </Text>
              <InlineCode variant="neutral">{view.organizationId}</InlineCode>
            </HStack>
          ) : (
            <Text color="fg.muted">None. This request reaches no organization.</Text>
          )}
        </Fact>
        <Fact label="Access">
          <ScopeList scopes={view.scopes} />
        </Fact>
        <Fact label="Reason">
          <Text whiteSpace="pre-wrap" wordBreak="break-word" data-testid="staff-access-reason">
            {view.reason}
          </Text>
        </Fact>
        <Fact label="Agent">
          <Text>{view.requesterName}</Text>
        </Fact>
        <Fact label="Machine">
          <Text wordBreak="break-word">{view.machine}</Text>
        </Fact>
        <Fact label="Request IP">
          <Text fontFamily="mono">{view.requestIp ?? "Not recorded"}</Text>
        </Fact>
        <Fact label="Expires">{expiry}</Fact>
      </Grid>
    </Card>
  );
}
