import { Link } from "@langwatch/browser-host/link";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button } from "@langwatch/design-system/primitives";
import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

import { useOrganizationHost } from "../../model/organization-host.ts";

export function TeamAccessWaiting({
  organizationName,
  onCheckAccess,
}: {
  organizationName: string;
  onCheckAccess: () => void;
}) {
  const host = useOrganizationHost();
  return (
    <Dialog.Root
      open
      size="cover"
      placement="center"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      onOpenChange={() => void 0}
    >
      <Dialog.Content aria-label="Waiting for team access">
        <Dialog.Header>
          <Dialog.Title>Waiting for team access</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <RestrictedAccess
            compact
            area={`projects in ${organizationName}`}
            description="You are not part of any team in this organization. Ask an organization admin to add you to a team so you can open its projects."
            detail={`You’re signed in to ${organizationName}.`}
          />
        </Dialog.Body>
        <Dialog.Footer flexWrap="wrap">
          <Button variant="ghost" onClick={() => host.signOut()}>
            Sign out
          </Button>
          <Button asChild variant="outline">
            <Link unstyled href="/">
              Back to home
            </Link>
          </Button>
          <Button variant="outline" onClick={onCheckAccess}>
            Check access
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
export default TeamAccessWaiting;
