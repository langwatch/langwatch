import { Popover } from "@langwatch/design-system/popover";
import { Button } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export function Tooltip({
  tip,
  children,
}: {
  tip?: string;
  headline?: string;
  cta?: string;
  href?: string;
  children?: ReactNode;
}) {
  if (!tip) return <>{children}</>;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="plain"
          size="xs"
          display="inline"
          height="auto"
          minWidth="0"
          padding="0"
          font="inherit"
          color="inherit"
          textDecoration="underline dotted"
          textUnderlineOffset="3px"
        >
          {children}
        </Button>
      </Popover.Trigger>
      <Popover.Content maxWidth="280px" padding="3" fontSize="14px">
        <Popover.Body>{tip}</Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
