import { Alert, Button, CloseButton, HStack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuArrowRight } from "react-icons/lu";

import { api } from "~/utils/api";

const DOCS_URL = "https://docs.langwatch.ai/self-hosting/data-and-telemetry";

/**
 * The notice itself, apart from the decision to show it
 * (specs/self-hosting/checkup/startup-notice.feature).
 */
export function StartupNoticeBanner({
  organizationId,
  schemaVersion,
  onDismissed,
}: {
  organizationId: string;
  schemaVersion: number;
  onDismissed?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const dismiss = api.checkup.dismissStartupNotice.useMutation({
    trpc: { context: { keepalive: true } },
  });

  if (dismissed) return null;

  const onDismiss = () => {
    setDismissed(true);
    dismiss.mutate({ organizationId, schemaVersion });
    onDismissed?.();
  };

  return (
    <Alert.Root
      status="info"
      width="full"
      border="1px solid"
      borderColor="colorPalette.muted"
      borderRadius={0}
      borderTopLeftRadius="xl"
      data-testid="startup-notice"
    >
      <Alert.Indicator />
      <Alert.Content>
        <HStack width="full" flexWrap="wrap" gap={3}>
          <Text>
            This install sends one usage report a day to LangWatch: counts and
            metadata, never content. See every field and switch parts of it off
            on the Checkup page.
          </Text>
          <Button size="xs" variant="outline" colorPalette="blue" asChild>
            <a href="/settings/checkup">
              Open Checkup <LuArrowRight size={12} />
            </a>
          </Button>
          <Button size="xs" variant="ghost" colorPalette="blue" asChild>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              What is sent
            </a>
          </Button>
        </HStack>
      </Alert.Content>
      <CloseButton
        size="sm"
        position="absolute"
        right={2}
        top={2}
        aria-label="Dismiss"
        onClick={onDismiss}
      />
    </Alert.Root>
  );
}
