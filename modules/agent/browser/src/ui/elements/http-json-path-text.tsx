import { Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { checkJsonPath, parseJsonPath, type PathSegment } from "../../model/json-path-segments.ts";

const COLOUR: Record<PathSegment["kind"], string> = {
  root: "purple.fg",
  dot: "fg.muted",
  property: "blue.fg",
  index: "orange.fg",
  other: "fg",
};

/**
 * A JSONPath in token colours. With a known `shape`, a segment that does not resolve
 * is muted with a wavy underline and says what is missing.
 */
export function HttpJsonPathText({
  path,
  shape,
  anyIndex = false,
}: {
  path: string;
  shape?: unknown;
  anyIndex?: boolean;
}) {
  const segments = parseJsonPath({ path });
  const statuses =
    shape === undefined
      ? segments.map(() => "unchecked" as const)
      : checkJsonPath({ segments, shape, anyIndex });

  return (
    <Text as="span" fontFamily="mono" fontSize="xs" data-testid="json-path-text">
      {segments.map((segment, index) => {
        const missing = statuses[index] === "missing";
        const node = (
          <Text
            as="span"
            key={index}
            color={missing ? "fg.muted" : COLOUR[segment.kind]}
            textDecoration={missing ? "underline wavy" : undefined}
            data-status={statuses[index]}
          >
            {segment.text}
          </Text>
        );
        return missing ? (
          <Tooltip key={index} content={`no \`${String(segment.key)}\` in the response`}>
            {node}
          </Tooltip>
        ) : (
          node
        );
      })}
    </Text>
  );
}
