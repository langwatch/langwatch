import { Box, type BoxProps } from "@chakra-ui/react";
import type React from "react";

interface InlineCodeProps extends Omit<BoxProps, "children"> {
  children: string;
  /**
   * Where a value too long for its box is cut. `end` suits names and text;
   * `middle` suits ids, hashes, keys and paths, where both ends matter.
   */
  truncate?: "end" | "middle";
  /** Characters `middle` keeps after the cut; defaults to a path's last segment, else 6. */
  tail?: number;
  /** One click selects the whole value, so a copy takes all of it. On by default. */
  selectOnClick?: boolean;
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

const MAX_PATH_TAIL = 24;

/** How much of `text` stays visible after a middle cut. */
export function middleTail({ text, tail }: { text: string; tail?: number }): number {
  if (tail !== undefined) return Math.min(Math.max(0, tail), text.length);
  const slash = text.lastIndexOf("/");
  const segment = text.length - slash;
  if (slash > 0 && segment <= MAX_PATH_TAIL) return segment;
  return Math.min(6, text.length);
}

const SELECT_ALL = { userSelect: "all", WebkitUserSelect: "all" } as const;

/**
 * The one look for a machine identifier in running UI: event names, permission ids,
 * slugs, model ids, env vars, headers, cron and regex text. Truncates with a title.
 */
export function InlineCode({
  children,
  truncate = "end",
  tail,
  selectOnClick = true,
  ...props
}: InlineCodeProps): React.ReactElement {
  const shared = {
    as: "code",
    title: children,
    "data-truncate": truncate,
    verticalAlign: "baseline",
    maxWidth: "full",
    whiteSpace: "nowrap",
    paddingX: "1",
    borderRadius: "xs",
    bg: "blue.subtle",
    color: "blue.fg",
    fontFamily: "mono",
    fontSize: "0.875em",
    css: selectOnClick ? SELECT_ALL : undefined,
  } as const;

  if (truncate === "middle") {
    const cut = children.length - middleTail({ text: children, tail });
    // Both halves stay in the DOM, so a selection copies the whole value; only the
    // head shrinks, and its ellipsis is drawn, never copied.
    return (
      <Box {...shared} display="inline-flex" minWidth={0} {...props}>
        <Box as="span" overflow="hidden" textOverflow="ellipsis" minWidth={0}>
          {renderGlob(children.slice(0, cut))}
        </Box>
        <Box as="span" flexShrink={0}>
          {renderGlob(children.slice(cut))}
        </Box>
      </Box>
    );
  }

  return (
    <Box {...shared} display="inline-block" overflow="hidden" textOverflow="ellipsis" {...props}>
      {renderGlob(children)}
    </Box>
  );
}
