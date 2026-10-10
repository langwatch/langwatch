import { Link } from "@langwatch/browser-host/link";
import { AccessStateIcon } from "@langwatch/design-system/access-state";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import { accessRequestText } from "@langwatch/design-system/restricted-access";
import { useRef, useState } from "react";

import { useOrganizationHost } from "../../model/organization-host.ts";

export function TeamAccessWaiting({
  organizationName,
  onCheckAccess,
}: {
  organizationName: string;
  onCheckAccess: () => void;
}) {
  const host = useOrganizationHost();
  const checkAccessRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(
        accessRequestText({ area: `projects in ${organizationName}`, link: window.location.href }),
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <Dialog.Root
      open
      size="md"
      placement="center"
      initialFocusEl={() => checkAccessRef.current}
      closeOnInteractOutside={false}
      closeOnEscape={false}
      onOpenChange={() => void 0}
    >
      <Dialog.Content aria-label="Waiting for team access" marginX={4} maxWidth="xl">
        <Dialog.Header>
          <VStack align="start" gap={4}>
            <AccessStateIcon kind="permission" compact />
            <Dialog.Title>Waiting for team access</Dialog.Title>
          </VStack>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Dialog.Description>
              Ask an organization admin to add you to a team in {organizationName} so you can open
              its projects.
            </Dialog.Description>
            <Text color="fg.muted" fontSize="sm">
              You’re signed in to {organizationName}.
            </Text>
            {copyStatus === "copied" && (
              <Text as="output" fontSize="sm" color="fg.muted">
                Send the copied request to an organization admin.
              </Text>
            )}
            {copyStatus === "failed" && (
              <Text role="alert" fontSize="sm" color="fg.muted">
                Couldn't copy the request. Send this page's address to an organization admin.
              </Text>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer flexWrap="wrap" gap={2}>
          <Button size="sm" variant="ghost" onClick={() => host.signOut()}>
            Sign out
          </Button>
          <Button size="sm" asChild variant="ghost">
            <Link unstyled href="/">
              Back to home
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void copyRequest()}>
            {copyStatus === "copied" ? "Request copied" : "Copy access request"}
          </Button>
          <Button ref={checkAccessRef} size="sm" colorPalette="orange" onClick={onCheckAccess}>
            Check access
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
export default TeamAccessWaiting;
