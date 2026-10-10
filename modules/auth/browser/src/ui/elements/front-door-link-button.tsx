import { Link } from "@langwatch/browser-host/link";
import { Button } from "@langwatch/design-system/primitives";

import {
  FRONT_DOOR_ACTION_GEOMETRY,
  FRONT_DOOR_PRIMARY_STYLE,
} from "./front-door-primary-button.tsx";

/**
 * A way to another page, drawn as a full-width button: solid when it is the card's one way
 * on, outline when it is the alternative. Cards offer these through AuthCard's `actions`.
 */
export function FrontDoorLinkButton({
  href,
  label,
  tone = "primary",
  testId,
}: {
  href: string;
  /** The action itself, in the imperative. */
  label: string;
  tone?: "primary" | "secondary";
  testId?: string;
}) {
  const link = (
    <Link href={href} data-testid={testId}>
      {label}
    </Link>
  );

  if (tone === "primary") {
    return (
      <Button asChild {...FRONT_DOOR_PRIMARY_STYLE}>
        {link}
      </Button>
    );
  }

  return (
    <Button
      asChild
      variant="outline"
      {...FRONT_DOOR_ACTION_GEOMETRY}
      borderColor="frontDoor.fieldBorder"
      _hover={{ backgroundColor: "frontDoor.fieldBg", borderColor: "fg.subtle" }}
    >
      {link}
    </Button>
  );
}
