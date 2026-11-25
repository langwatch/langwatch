// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * "Test connection" for a cloud agent source: asks the provider to list its agents without
 * recording anything, and says what came back. A draft is tested as typed; a saved source as saved.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import { Alert, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { TestAgentListingResult } from "@langwatch/enterprise-governance-contract";
import { useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import { useShowErrorToast } from "../../../../behavior/governance-feedback.ts";
import { agentListingTestCopy } from "../../../../features/ingestion-sources/model/agent-listing-test-copy.ts";
import type { agentListingTestInput } from "./cloud-agent-pull-config.ts";

export type AgentListingTestTarget =
  | { kind: "draft"; input: ReturnType<typeof agentListingTestInput> }
  | { kind: "saved"; sourceId: string };

/** The key a result answers for; a draft edited after its test no longer shows the old result. */
function targetKey(target: AgentListingTestTarget): string | null {
  if (target.kind === "saved") return `saved:${target.sourceId}`;
  return target.input ? JSON.stringify(target.input) : null;
}

function testHint({ hasInput, kind }: { hasInput: boolean; kind: AgentListingTestTarget["kind"] }) {
  if (!hasInput) return "Fill in the required fields to test.";
  if (kind === "saved") return "Tests the saved settings. Nothing is recorded.";
  return "Lists your agents once. Nothing is recorded.";
}

function AgentListingTestResult({ result }: { result: TestAgentListingResult }) {
  const copy = agentListingTestCopy(result);
  return (
    <Alert.Root status={copy.status} size="sm" data-testid="agent-listing-test-result">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{copy.title}</Alert.Title>
        {copy.description && <Alert.Description>{copy.description}</Alert.Description>}
      </Alert.Content>
    </Alert.Root>
  );
}

export function AgentListingTest({
  organizationId,
  target,
}: {
  organizationId: string;
  target: AgentListingTestTarget;
}) {
  const showErrorToast = useShowErrorToast();
  const [answered, setAnswered] = useState<{ key: string; result: TestAgentListingResult } | null>(
    null,
  );
  const onError = (error: unknown) =>
    showErrorToast({ error, fallbackTitle: "Couldn't test the connection" });
  const testDraft = api.ingestionSources.testAgentListing.useMutation({ onError });
  const testSaved = api.ingestionSources.testAgentListingForSource.useMutation({ onError });
  const key = targetKey(target);
  const isPending = testDraft.isPending || testSaved.isPending;

  const run = () => {
    if (!key || isPending) return;
    setAnswered(null);
    const onSuccess = (result: TestAgentListingResult) => setAnswered({ key, result });
    if (target.kind === "saved") {
      testSaved.mutate({ organizationId, sourceId: target.sourceId }, { onSuccess });
    } else if (target.input) {
      testDraft.mutate({ organizationId, ...target.input }, { onSuccess });
    }
  };

  return (
    <VStack align="stretch" gap={2} data-testid="agent-listing-test">
      <HStack gap={3}>
        <Button size="xs" variant="outline" onClick={run} loading={isPending} disabled={!key}>
          Test connection
        </Button>
        <Text fontSize="xs" color="fg.muted">
          {testHint({ hasInput: !!key, kind: target.kind })}
        </Text>
      </HStack>
      {answered && answered.key === key && <AgentListingTestResult result={answered.result} />}
    </VStack>
  );
}
