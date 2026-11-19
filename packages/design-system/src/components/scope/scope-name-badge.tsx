import { Badge, HStack, Text } from "../../primitives.ts";

/**
 * A team's or project's own name as the platform's green badge, so it stands
 * out from the words around it. A long name truncates; hovering shows it whole.
 */
export function ScopeNameBadge({ name, maxWidth = "12rem" }: { name: string; maxWidth?: string }) {
  return (
    <Badge
      size="sm"
      colorPalette="green"
      title={name}
      maxWidth={maxWidth}
      minWidth={0}
      flexShrink={1}
      verticalAlign="middle"
      data-testid="scope-name-badge"
    >
      <Text as="span" truncate>
        {name}
      </Text>
    </Badge>
  );
}

/** "Team [Platform]": the scope kind, then its name as a badge; read aloud as "Team Platform". */
export function NamedScope({
  kind,
  name,
  maxWidth,
}: {
  kind: string;
  name: string;
  maxWidth?: string;
}) {
  return (
    <HStack as="span" gap={1.5} minWidth={0}>
      <Text as="span" flexShrink={0}>
        {kind}
      </Text>{" "}
      <ScopeNameBadge name={name} maxWidth={maxWidth} />
    </HStack>
  );
}

/** What tells a same-name project apart, as a badge at the row's far end. */
export function ProjectHintBadge({ hint }: { hint: string | undefined }) {
  if (!hint) return null;
  return (
    <HStack as="span" marginInlineStart="auto" paddingInlineStart={2} minWidth={0} flexShrink={1}>
      <ScopeNameBadge name={hint} maxWidth="10rem" />
    </HStack>
  );
}

/** A row's accessible name when it carries a hint: "Eval Harness, Research". */
export function hintedRowLabel({
  parts,
  hint,
}: {
  parts: (string | false | undefined)[];
  hint: string | undefined;
}): string | undefined {
  return hint ? [...parts, hint].filter(Boolean).join(", ") : undefined;
}
