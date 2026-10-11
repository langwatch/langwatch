import { Box, Button, Flex, Text } from "@langwatch/design-system/primitives";
import { Link2 } from "lucide-react";

import type { SessionView } from "../model/session-controller.ts";

export function SessionSlot({
  view,
  selected,
  onConnect,
  onDisconnect,
}: {
  view: SessionView;
  selected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <Box
      data-docs-session=""
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      padding="4"
      bg="bg.subtle"
    >
      <Text fontSize="13px" fontWeight="600" color="fg" margin="0">
        LangWatch session
      </Text>
      <Text fontSize="13px" lineHeight="22px" color="docs.lede" marginTop="1" marginBottom="3">
        Demo only. Try a short-lived connection to one project. Requests are simulated.
      </Text>
      <Box
        as="output"
        display="block"
        aria-live="polite"
        fontSize="13px"
        lineHeight="22px"
        color="fg"
        marginBottom={selected ? "3" : "0"}
      >
        {view.kind === "ready" ? (
          <>
            <Text as="span" display="block" margin="0" fontWeight="600">
              {view.projectName}
            </Text>
            <Text as="span" display="block" margin="0">
              Trace reading · Expires at{" "}
              {new Intl.DateTimeFormat(void 0, { timeStyle: "medium" }).format(view.expiresAt)}
            </Text>
          </>
        ) : null}
        {view.kind === "expired" ? "Session expired. Connect again to continue." : null}
        {view.kind === "error" ? view.message : null}
        {view.kind === "connecting" ? "Connecting…" : null}
      </Box>
      <Flex gap="2" wrap="wrap">
        {view.kind !== "ready" ? (
          <Button
            size="sm"
            variant="outline"
            colorPalette="gray"
            minHeight="44px"
            whiteSpace="normal"
            disabled={view.kind === "connecting"}
            onClick={onConnect}
          >
            <Link2 size={16} aria-hidden="true" />
            Use my LangWatch session
          </Button>
        ) : null}
        {selected ? (
          <Button
            size="sm"
            variant="ghost"
            colorPalette="gray"
            minHeight="44px"
            onClick={onDisconnect}
          >
            {view.kind === "connecting" ? "Cancel connection" : "Disconnect"}
          </Button>
        ) : null}
      </Flex>
    </Box>
  );
}
