import { Link } from "@langwatch/browser-host/link";
import { AccessStateIcon } from "@langwatch/design-system/access-state";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { accessRequestText } from "@langwatch/design-system/restricted-access";
import { useState } from "react";

import { useOrganizationHost } from "../../model/organization-host.ts";

export function TeamAccessWaiting({
  organizationName,
  onCheckAccess,
}: {
  organizationName: string;
  onCheckAccess: () => void;
}) {
  const host = useOrganizationHost();
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
    <Dialog
      open
      onClose={() => void 0}
      title="Waiting for team access"
      size="md"
      placement="center"
      dismissible={false}
      initialFocus="primary"
      description={`Ask an organization admin to add you to a team in ${organizationName} so you can open its projects.`}
      note={
        <HStack gap={2}>
          <Button size="sm" variant="ghost" onClick={() => host.signOut()}>
            Sign out
          </Button>
          <Button size="sm" asChild variant="ghost">
            <Link unstyled href="/">
              Back to home
            </Link>
          </Button>
        </HStack>
      }
      secondaryAction={{
        label: copyStatus === "copied" ? "Request copied" : "Copy access request",
        onClick: () => void copyRequest(),
      }}
      primaryAction={{ label: "Check access", onClick: onCheckAccess }}
    >
      <VStack align="stretch" gap={3}>
        <AccessStateIcon kind="permission" compact />
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
    </Dialog>
  );
}
export default TeamAccessWaiting;
