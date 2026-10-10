import { Button, Center, Circle, HStack, Heading, Stack, Text } from "@chakra-ui/react";
import { Check, Copy, Lock } from "lucide-react";
import { useState } from "react";

import { toaster } from "../overlays/toaster.tsx";

export type RestrictedAccessProps = {
  /** The permission the viewer is missing, as `resource:action`. */
  permission: string;
  /** What the viewer cannot open, as a noun phrase: "this page", "directory provisioning". */
  area?: string;
  /** Who is asking, written into the copied request when known. */
  requesterName?: string;
  "data-testid"?: string;
};

/** `datasets:view` reads "view datasets"; `model-providers:manage`, "manage model providers". */
export function describePermission(permission: string): string {
  const [resource = permission, action] = permission.split(":");
  const subject = resource.replace(/[-_]/g, " ");
  return action ? `${action} ${subject}` : subject;
}

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

/** In place of a page the viewer's role cannot open: what is missing, and who can grant it. */
export function RestrictedAccess({
  permission,
  area = "this page",
  requesterName,
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
    <Center minHeight="60vh" padding={8} data-testid={testId}>
      <Stack gap={5} align="center" maxWidth="520px" textAlign="center">
        <Circle size={12} background="orange.subtle" color="orange.fg">
          <Lock size={20} aria-hidden />
        </Circle>
        <Stack gap={2} align="center">
          <Heading size="lg">You don't have access to {area}</Heading>
          <Text color="fg.muted">
            Your role doesn't let you {describePermission(permission)}. An admin of your
            organization can give you access.
          </Text>
        </Stack>
        <HStack gap={2} justify="center" flexWrap="wrap">
          <Button size="sm" variant="solid" colorPalette="orange" onClick={copyRequest}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Request copied" : "Copy access request"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.history.back()}>
            Go back
          </Button>
        </HStack>
        <Text fontSize="xs" color="fg.subtle">
          Missing permission: {permission}
        </Text>
      </Stack>
    </Center>
  );
}
