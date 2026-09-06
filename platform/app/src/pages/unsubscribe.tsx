import { Box, Button, Heading, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

/**
 * ADR-031: public unsubscribe page. No auth guard — the `?token=` is the
 * authorization (HMAC-bound to one recipient). Offers the two scopes from the
 * footer link: this notification only, or all notifications from the project.
 */
export default function UnsubscribePage() {
  const router = useRouter();
  const token =
    typeof router.query.token === "string" ? router.query.token : "";
  const [done, setDone] = useState<null | "trigger" | "project">(null);

  const resolved = api.emailSuppression.resolveUnsubscribeToken.useQuery(
    { token },
    { enabled: !!token, retry: false },
  );
  const confirm = api.emailSuppression.confirmUnsubscribe.useMutation();

  const onConfirm = (scope: "trigger" | "project") => {
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
        {!router.isReady ? (
          <VStack gap={3}>
            <Spinner />
          </VStack>
        ) : !token || resolved.isError ? (
          <VStack align="start" gap={2}>
            <Heading size="md">Link not valid</Heading>
            <Text color="fg.muted">
              This unsubscribe link is invalid or has expired.
            </Text>
          </VStack>
        ) : resolved.isLoading || !resolved.data ? (
          <VStack gap={3}>
            <Spinner />
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
