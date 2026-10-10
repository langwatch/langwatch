import { Box, Button, Center, Heading, Skeleton, Stack, Text, VStack } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { bannerGlass, bannerRim } from "../../system/status-glass.ts";
import { InlineCode } from "../display/inline-code.tsx";
import { toaster } from "../overlays/toaster.tsx";

export type RestrictedAccessProps = {
  /** The permission the viewer is missing. */
  permission: string;
  /** What the viewer cannot open, as a noun phrase: "this page", "the directory". */
  area?: string;
  /** Who is asking, written into the copied request when known. */
  requesterName?: string;
  /** The page's own skeleton to blur behind the card; a neutral placeholder when absent. */
  backdrop?: ReactNode;
  "data-testid"?: string;
};

/** The words an admin needs to grant the access: who, what, and where. */
export function accessRequestText({
  permission,
  area,
  requesterName,
  link,
}: {
  permission: string;
  area: string;
  requesterName?: string;
  link: string;
}): string {
  return [
    `${requesterName ?? "I"} need${requesterName ? "s" : ""} access to ${area}.`,
    `Missing permission: ${permission}`,
    `Page: ${link}`,
  ].join("\n");
}

function Placeholder() {
  return (
    <VStack align="stretch" gap={4} padding={6} aria-hidden>
      <Skeleton height="8" width="40%" />
      <Skeleton height="24" />
      <Skeleton height="24" />
      <Skeleton height="24" width="70%" />
    </VStack>
  );
}

/** Restricted content: the page blurred behind a glass card naming the grant, with a way to ask. */
export function RestrictedAccess({
  permission,
  area = "this page",
  requesterName,
  backdrop,
  "data-testid": testId,
}: RestrictedAccessProps) {
  const copyRequest = () => {
    const text = accessRequestText({
      permission,
      area,
      link: window.location.href,
      ...(requesterName ? { requesterName } : {}),
    });
    void navigator.clipboard.writeText(text).then(
      () => toaster.create({ type: "success", title: "Access request copied" }),
      () => toaster.create({ type: "error", title: "Could not copy the request" }),
    );
  };

  return (
    <Box position="relative" minHeight="60vh" overflow="hidden" data-testid={testId}>
      <Box filter="blur(8px)" opacity={0.6} pointerEvents="none" userSelect="none" aria-hidden>
        {backdrop ?? <Placeholder />}
      </Box>
      <Center position="absolute" inset={0} padding={6}>
        <Stack
          role="note"
          gap={3}
          align="center"
          textAlign="center"
          maxWidth="440px"
          paddingX={8}
          paddingY={6}
          borderRadius="2xl"
          borderWidth="1px"
          borderColor={bannerRim("orange")}
          backdropFilter="blur(16px)"
          boxShadow="lg"
          {...bannerGlass("orange")}
        >
          <Box color={{ _light: "orange.600", _dark: "orange.300" }}>
            <Lock size={22} aria-hidden />
          </Box>
          <Heading size="md">You need access to {area}</Heading>
          <Text fontSize="sm" color="fg.muted">
            Ask an organization admin to grant you
          </Text>
          <InlineCode>{permission}</InlineCode>
          <Button size="sm" colorPalette="orange" onClick={copyRequest}>
            Copy access request
          </Button>
        </Stack>
      </Center>
    </Box>
  );
}
