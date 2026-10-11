import { Box, Button } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

import { useCopy } from "../lib/clipboard.ts";

export function LegacyContent({
  children,
  className,
  ...props
}: ComponentProps<"div"> & { "data-copy"?: string }) {
  const { state, copy, ready } = useCopy();
  const text = props["data-copy"];
  if (text)
    return (
      <Button
        data-docs-copy={text}
        variant="outline"
        colorPalette="gray"
        height="auto"
        minHeight="44px"
        padding="3"
        whiteSpace="normal"
        disabled={!ready}
        onClick={() => copy({ text })}
      >
        {state === "copied" ? "Copied" : children}
      </Button>
    );
  return <Box className={className}>{children}</Box>;
}
