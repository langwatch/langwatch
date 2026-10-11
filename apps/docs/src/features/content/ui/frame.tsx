import { Box } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export function Frame({
  caption,
  children,
}: {
  caption?: string;
  fullWidth?: boolean;
  children?: ReactNode;
}) {
  return (
    <Box
      as="figure"
      margin="0"
      marginY="6"
      padding="4"
      borderWidth="1px"
      borderColor="border"
      bg="bg.subtle"
      borderRadius="showcase"
      minWidth="0"
      css={{
        "& img, & video": { display: "block", margin: "0 auto", borderRadius: "md" },
        "& > p": { margin: "0" },
      }}
    >
      {children}
      {caption ? (
        <Box
          as="figcaption"
          marginTop="3"
          fontSize="12px"
          lineHeight="20px"
          color="fg.muted"
          textAlign="center"
        >
          {caption}
        </Box>
      ) : null}
    </Box>
  );
}
