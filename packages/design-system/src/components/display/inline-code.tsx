import { Box, type BoxProps } from "@chakra-ui/react";
import type React from "react";

interface InlineCodeProps extends Omit<BoxProps, "children"> {
  children: string;
}

/** Splits on `*` so a glob wildcard can be emphasised. */
function renderGlob(text: string): React.ReactNode {
  return text.split(/(\*)/).map((part, index) =>
    part === "*" ? (
      <Box as="span" key={`${index}-*`} color="purple.fg" fontWeight="semibold">
        *
      </Box>
    ) : (
      part
    ),
  );
}

/**
 * The one look for a machine identifier in running UI: event names, permission ids,
 * slugs, model ids, env vars, headers, cron and regex text. Truncates with a title.
 */
export function InlineCode({ children, ...props }: InlineCodeProps): React.ReactElement {
  return (
    <Box
      as="code"
      title={children}
      display="inline-block"
      verticalAlign="baseline"
      maxWidth="full"
      overflow="hidden"
      textOverflow="ellipsis"
      whiteSpace="nowrap"
      paddingX="1"
      borderRadius="xs"
      bg="blue.subtle"
      color="blue.fg"
      fontFamily="mono"
      fontSize="0.875em"
      {...props}
    >
      {renderGlob(children)}
    </Box>
  );
}
