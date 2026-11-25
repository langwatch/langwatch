import { Box, IconButton, VisuallyHidden } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";

import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";
import { InlineCode } from "../display/inline-code.tsx";

export interface IdTextProps {
  value: string;
  /** What the copy button names: "trace ID" reads "Copy trace ID". */
  label?: string;
  /** Characters kept after the middle cut; see InlineCode. */
  tail?: number;
  /** Shows the copy button; on by default. It appears on hover and on focus. */
  copyable?: boolean;
}

/**
 * An identifier in running UI (trace, span, key, project ids): neutral mono, cut in the
 * middle so both ends stay legible, the whole value in the title and in what is copied.
 */
export function IdText({ value, label = "ID", tail, copyable = true }: IdTextProps) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      gap={1}
      minWidth={0}
      maxWidth="full"
      className="group"
    >
      <InlineCode variant="neutral" truncate="middle" tail={tail}>
        {value}
      </InlineCode>
      {copyable && (
        <>
          <IconButton
            size="2xs"
            variant="ghost"
            color={copied ? "fg.success" : "fg.muted"}
            aria-label={`Copy ${label}`}
            opacity={copied ? 1 : 0}
            _groupHover={{ opacity: 1 }}
            _focusVisible={{ opacity: 1 }}
            css={{ "@media (hover: none)": { opacity: 1 } }}
            onClick={(event) => {
              event.stopPropagation();
              copy(value);
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </IconButton>
          <VisuallyHidden aria-live="polite">{copied ? "Copied" : ""}</VisuallyHidden>
        </>
      )}
    </Box>
  );
}
