/**
 * The unsubscribe landing (public, no auth guard; ADR-031). Token passed as
 * prop for authorization; offers two unsubscribe scopes: this notification or
 * entire project. Spec: specs/automations/unsubscribe-landing.feature
 */

import { Box, Button, Heading, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { automationApi } from "../../behavior/automation-api.ts";

/** Which of the two promises in the footer link the recipient took. */
export type UnsubscribeScope = "trigger" | "project";

export default function UnsubscribeScreen({ token }: { token: string }) {
  const [done, setDone] = useState<UnsubscribeScope | null>(null);

  const resolved = automationApi.emailSuppression.resolveUnsubscribeToken.useQuery(
    { token },
    { enabled: !!token, retry: false },
  );
  const confirm = automationApi.emailSuppression.confirmUnsubscribe.useMutation();

  const onConfirm = (scope: UnsubscribeScope) => {
    confirm.mutate({ token, scope }, { onSuccess: () => setDone(scope) });
  };

  function renderUnsubscribeBody() {
    if (!token || resolved.isError) {
      return (
        <VStack align="start" gap={2}>
          <Heading size="md">Link not valid</Heading>
          <Text color="fg.muted">This unsubscribe link is invalid or has expired.</Text>
        </VStack>
      );
    }
    if (resolved.isLoading || !resolved.data) {
      return (
        <VStack gap={3}>
          <Spinner data-testid="unsubscribe-loading" />
        </VStack>
      );
    }
    if (done) {
      return (
        <VStack align="start" gap={2}>
          <Heading size="md">You&apos;re unsubscribed</Heading>
          <Text color="fg.muted">
            {done === "project"
              ? `${resolved.data.email} will no longer receive notifications from ${resolved.data.projectName}.`
              : `${resolved.data.email} will no longer receive ${
                  resolved.data.triggerName ?? "this notification"
                }.`}
          </Text>
        </VStack>
      );
    }
    return (
      <VStack align="start" gap={4}>
        <Heading size="md">Unsubscribe</Heading>
        <Text color="fg.muted">
          Choose how {resolved.data.email} should stop receiving email from{" "}
          {resolved.data.projectName}.
        </Text>
        <VStack align="stretch" width="full" gap={3}>
          {resolved.data.triggerName && (
            <Button
              variant="outline"
              loading={confirm.isPending}
              onClick={() => onConfirm("trigger")}
            >
              Stop receiving {resolved.data.triggerName}
            </Button>
          )}
          <Button
            colorPalette="red"
            loading={confirm.isPending}
            onClick={() => onConfirm("project")}
          >
            Stop all notifications from {resolved.data.projectName}
          </Button>
        </VStack>
      </VStack>
    );
  }

  return (
    <Box
      minH="100vh"
      bg="bg.subtle"
      display="flex"
      alignItems="center"
      justifyContent="center"
      padding={6}
    >
      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        padding={8}
        maxW="480px"
        width="full"
      >
        {renderUnsubscribeBody()}
      </Box>
    </Box>
  );
}
