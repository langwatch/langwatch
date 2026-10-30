/**
 * The parameters the situation declares inline, read-only: they are edited in the text.
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { InlineDeclaration } from "@langwatch/scenario-contract";

import { SECRET_IN_SITUATION_MESSAGE } from "./use-case-editor.ts";

/** One row per name, and one more per conflict; a repeat of a default adds nothing. */
function listedDeclarations(declarations: readonly InlineDeclaration[]): InlineDeclaration[] {
  const seen = new Set<string>();
  return declarations.filter((declaration) => {
    const { name, status, defaultValue } = declaration;
    const key = `${status.kind}:${name}:${status.kind === "duplicate" ? defaultValue : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const CONFLICT_BADGE = {
  duplicate: { label: "declared twice", colorPalette: "orange" },
  stored: { label: "stored wins", colorPalette: "orange" },
  secret: { label: "secret", colorPalette: "red" },
} as const;

/** What the row says next to the name. A secret's value is never shown. */
function InlineParameterDetail({ declaration }: { declaration: InlineDeclaration }) {
  const { name, status, defaultValue } = declaration;
  switch (status.kind) {
    case "secret":
      return <Text color="fg.muted">{SECRET_IN_SITUATION_MESSAGE}</Text>;
    case "duplicate":
      return (
        <Text color="fg.muted">
          {name} is declared twice; the first default, {status.usedDefault}, is used
        </Text>
      );
    case "stored":
      return (
        <Text color="fg.muted">
          Stored parameter wins
          {status.storedDefault === undefined ? "" : `, default ${String(status.storedDefault)}`}
        </Text>
      );
    case "declared":
      return (
        <Text fontFamily="mono" color="fg.muted" truncate minWidth={0}>
          {defaultValue}
        </Text>
      );
  }
}

export function InlineParameterList({
  declarations,
}: {
  declarations: readonly InlineDeclaration[];
}) {
  if (declarations.length === 0) return null;

  return (
    <VStack align="stretch" gap={1} marginTop={2} data-testid="case-inline-parameters">
      {listedDeclarations(declarations).map((declaration) => (
        <HStack
          key={`${declaration.status.kind}:${declaration.start}`}
          gap={2}
          textStyle="caption"
          data-testid={`inline-parameter-${declaration.status.kind}-${declaration.name}`}
        >
          <Text fontFamily="mono" fontWeight="medium" flexShrink={0}>
            {declaration.name}
          </Text>
          <InlineParameterDetail declaration={declaration} />
          <HStack gap={1} flexShrink={0} marginLeft="auto">
            {declaration.status.kind !== "declared" && (
              <Badge
                size="xs"
                variant="subtle"
                colorPalette={CONFLICT_BADGE[declaration.status.kind].colorPalette}
              >
                {CONFLICT_BADGE[declaration.status.kind].label}
              </Badge>
            )}
            <Badge size="xs" variant="subtle" colorPalette="gray">
              from situation
            </Badge>
          </HStack>
        </HStack>
      ))}
    </VStack>
  );
}
