import { Button, HStack, Text } from "@chakra-ui/react";
import { useState } from "react";

/**
 * Shown when the server holds a newer version of this workbench and the user
 * has unsaved edits. Reloading discards those edits, so it is the user's
 * button to press, never automatic; a clean workbench reloads silently and
 * this banner never appears (`useWorkbenchUpdateListener`).
 */
export function WorkbenchStaleBanner({
  actorLabel,
  onReload,
}: {
  actorLabel?: string;
  onReload: () => Promise<void>;
}) {
  const [isReloading, setIsReloading] = useState(false);

  const who =
    actorLabel === "langy"
      ? "Langy updated this evaluation"
      : actorLabel === "api"
        ? "This evaluation was updated through the API"
        : "This evaluation was updated somewhere else";

  return (
    <HStack
      data-testid="workbench-stale-banner"
      paddingX={6}
      paddingY={2}
      background="orange.subtle"
      borderBottomWidth="1px"
      borderColor="orange.muted"
      gap={3}
      flexShrink={0}
    >
      <Text fontSize="sm" color="fg">
        {who}. Reloading shows the latest version and discards your unsaved
        edits.
      </Text>
      <Button
        size="xs"
        colorPalette="orange"
        loading={isReloading}
        onClick={() => {
          setIsReloading(true);
          void onReload().finally(() => setIsReloading(false));
        }}
      >
        Reload
      </Button>
    </HStack>
  );
}
