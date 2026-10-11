import { Flex } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function ResponsiveExamples({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 90rem)");
    const update = () => setOpen(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <details
      className="docs-examples"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Request and response examples</summary>
      <Flex direction="column" gap="6" minWidth="0">
        {children}
      </Flex>
    </details>
  );
}
