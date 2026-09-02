/**
 * The unsubscribe landing, reached from the footer of a notification email.
 *
 * `platform/app/src/pages/unsubscribe.tsx`, moved whole. ADR-031: this is a
 * PUBLIC page and there is no auth guard, because the `?token=` IS the
 * authorization — its HMAC binds it to one recipient. It offers the two scopes
 * the footer link promises: this notification only, or every notification from
 * the project.
 *
 * THE TOKEN IS A PROP, NOT A READING. Every other screen in this package asks
 * the automation host for the address, and this one may not: the host answers
 * for the session, the organization, the team and the project, and a recipient
 * opening a link from a mail client has none of those. The frontend feature
 * reads the query and hands the token over, which is the same "the route table
 * already knew" argument the tab-as-prop shape makes one directory across.
 *
 * WHAT DID NOT TRAVEL, named rather than quietly dropped: the page held its
 * first render behind `router.isReady`, a Next-era reading that says the query
 * string has been parsed. Under the router this application runs, the query is
 * parsed before the first render, so the branch could only ever be false — and
 * a spinner nothing can reach is a promise nothing keeps. A missing token still
 * lands on the same "Link not valid" panel it always did.
 *
 * NOTHING ON THIS PAGE IS LOGGED OR PUT BACK IN AN ADDRESS. The token stays in
 * the URL it arrived in and is sent to exactly one procedure; the resolved
 * email is rendered as the server masked it and never written anywhere else.
 *
 * Spec: specs/automations/unsubscribe-landing.feature
 */

import { Box, Button, Heading, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { automationApi } from "../../behavior/automation-api";

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
        {!token || resolved.isError ? (
          <VStack align="start" gap={2}>
            <Heading size="md">Link not valid</Heading>
            <Text color="fg.muted">This unsubscribe link is invalid or has expired.</Text>
          </VStack>
        ) : resolved.isLoading || !resolved.data ? (
          <VStack gap={3}>
            <Spinner data-testid="unsubscribe-loading" />
          </VStack>
        ) : done ? (
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
        ) : (
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
        )}
      </Box>
    </Box>
  );
}
