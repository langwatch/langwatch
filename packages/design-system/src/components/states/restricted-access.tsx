import {
  Box,
  Button,
  Center,
  HStack,
  Heading,
  Skeleton,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Copy, Lock } from "lucide-react";
import { useState, type ReactNode } from "react";

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

/** Restricted content: the page blurred behind a plain dialog naming the grant and how to ask. */
export function RestrictedAccess({
  permission,
  area = "this page",
  requesterName,
  backdrop,
  "data-testid": testId,
}: RestrictedAccessProps) {
  const [copied, setCopied] = useState(false);
  const copyRequest = () => {
    const text = accessRequestText({
      permission,
      area,
      link: window.location.href,
      ...(requesterName ? { requesterName } : {}),
    });
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        toaster.create({ type: "success", title: "Access request copied" });
      },
      () => toaster.create({ type: "error", title: "Could not copy the request" }),
    );
  };

  return (
    <Box position="relative" minHeight="60vh" overflow="hidden" data-testid={testId}>
      <Box filter="blur(6px)" opacity={0.5} pointerEvents="none" userSelect="none" aria-hidden>
        {backdrop ?? <Placeholder />}
      </Box>
      <Center position="absolute" inset={0} padding={6}>
        <Stack
          role="note"
          gap={4}
          width="full"
          maxWidth="420px"
          padding={6}
          borderRadius="l3"
          borderWidth="1px"
          borderColor="border.muted"
          background="bg.panel"
          boxShadow="lg"
        >
          <HStack gap={3} align="center">
            <Center
              boxSize={9}
              flexShrink={0}
              borderRadius="l2"
              background="bg.muted"
              color="fg.muted"
            >
              <Lock size={16} aria-hidden />
            </Center>
            <Heading size="md">You need access to {area}</Heading>
          </HStack>
          <Text fontSize="sm" color="fg.muted" lineHeight="1.6">
            Your role doesn't include <InlineCode>{permission}</InlineCode>. Copy a request and send
            it to an organization admin, who can grant it.
          </Text>
          <HStack justify="end" gap={2} paddingTop={1}>
            <Button size="sm" variant="ghost" onClick={() => window.history.back()}>
              Go back
            </Button>
            <Button size="sm" variant="outline" onClick={copyRequest}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy access request"}
            </Button>
          </HStack>
        </Stack>
      </Center>
    </Box>
  );
}
