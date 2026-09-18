import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useFilterStore } from "@langwatch/trace-browser-kit";
import { walkAST } from "@langwatch/trace-contract";
import { X } from "lucide-react";
import { useMemo } from "react";

/**
 * Empty-state companion that breaks the active query down into removable chips so a
 * user can drop individual pieces without retyping the whole thing.
 */
interface BreakdownEntry {
  /** Stable id within the chip list — `${field}:${value}:${kind}`. */
  id: string;
  /** Display label, e.g. `status:error`, `Ω`, `duration > 1000`. */
  label: string;
  /** What kind of remove call to fire on click. */
  remove: () => void;
  /** When true, render the chip with a warning tone — surfaces tokens
   *  the parser couldn't make sense of (free-text glyphs the user
   *  almost certainly didn't mean to type). */
  warn?: boolean;
}

function buildLiteralBreakdownEntry({
  value,
  isFielded,
  fieldName,
  operator,
  negated,
  freeTextIndex,
  removeFacet,
  removeField,
  removeFreeText,
}: {
  value: string;
  isFielded: boolean;
  fieldName: string;
  operator: string;
  negated: boolean;
  freeTextIndex: number;
  removeFacet: (field: string, value: string) => void;
  removeField: (field: string) => void;
  removeFreeText: (value: string) => void;
}): BreakdownEntry {
  if (!isFielded) {
    return {
      id: `t:${freeTextIndex}:${value}`,
      label: value,
      remove: () => removeFreeText(value),
      warn: /[^\w\s.\-/_:'"`]/.test(value),
    };
  }

  if (operator !== ":") {
    return {
      id: `c:${fieldName}:${operator}:${value}`,
      label: `${negated ? "NOT " : ""}${fieldName} ${operator.slice(1)} ${value}`,
      remove: () => removeField(fieldName),
    };
  }

  return {
    id: `f:${fieldName}:${value}:${negated ? "n" : "p"}`,
    label: `${negated ? "NOT " : ""}${fieldName}:${value}`,
    remove: () => removeFacet(fieldName, value),
  };
}

export function QueryBreakdownChips() {
  const ast = useFilterStore((s) => s.ast);
  const removeFacet = useFilterStore((s) => s.removeFacet);
  const removeField = useFilterStore((s) => s.removeField);
  const removeFreeText = useFilterStore((s) => s.removeFreeText);

  const entries = useMemo<BreakdownEntry[]>(() => {
    const out: BreakdownEntry[] = [];
    let freeTextIdx = 0;
    walkAST(ast, (node, negated) => {
      if (node.type !== "Tag") return;
      const op = node.operator?.operator ?? ":";
      const isFielded = node.field.type !== "ImplicitField";
      const fieldName = isFielded ? (node.field as { name: string }).name : "";
      const exprType = node.expression?.type;

      if (exprType === "LiteralExpression") {
        const value = String(node.expression.value);
        out.push(
          buildLiteralBreakdownEntry({
            value,
            isFielded,
            fieldName,
            operator: op,
            negated,
            freeTextIndex: freeTextIdx,
            removeFacet,
            removeField,
            removeFreeText,
          }),
        );
        if (!isFielded) freeTextIdx++;
        return;
      }
      if (exprType === "RangeExpression" && isFielded) {
        const min = node.expression.range.min;
        const max = node.expression.range.max;
        out.push({
          id: `r:${fieldName}:${min}-${max}`,
          label: `${fieldName} ∈ [${min}, ${max}]`,
          remove: () => removeField(fieldName),
        });
        return;
      }
      // Any remaining shape on a fielded predicate with a non-bare
      // operator (`duration:>1000`, regex, etc.) — express as
      // "fieldName operator" since `removeField` is whole-field
      // anyway. RegexExpression and EmptyExpression also fall through
      // here so they're at least removable from the breakdown.
      if (isFielded && op !== ":") {
        out.push({
          id: `c:${fieldName}:${op}`,
          label: `${fieldName} ${op.slice(1)}`,
          remove: () => removeField(fieldName),
        });
      }
    });
    return out;
  }, [ast, removeFacet, removeField, removeFreeText]);

  if (entries.length === 0) return null;

  return (
    <VStack gap={2} align="stretch" maxWidth="640px">
      <Text textStyle="2xs" color="fg.muted" textAlign="center">
        Active filters: click × on any chip to drop just that piece.
      </Text>
      <HStack gap={1.5} flexWrap="wrap" justify="center">
        {entries.map((entry) => (
          <BreakdownChip key={entry.id} entry={entry} />
        ))}
      </HStack>
    </VStack>
  );
}

function BreakdownChip({ entry }: { entry: BreakdownEntry }) {
  return (
    <Tooltip
      content={
        entry.warn
          ? `"${entry.label}" looks like an accidental character. Click × to drop it.`
          : `Remove ${entry.label}`
      }
      positioning={{ placement: "top" }}
      openDelay={500}
    >
      <HStack
        gap={1}
        paddingLeft={2}
        paddingRight={1}
        paddingY={0.5}
        borderRadius="full"
        borderWidth="1px"
        colorPalette={entry.warn ? "orange" : "gray"}
        borderColor={entry.warn ? "colorPalette.muted" : "border.subtle"}
        bg={entry.warn ? "colorPalette.subtle" : "bg.muted"}
        color="fg"
      >
        <Text
          textStyle="xs"
          color={entry.warn ? "colorPalette.fg" : "fg"}
          fontFamily="mono"
          maxWidth="200px"
          truncate
        >
          {entry.label}
        </Text>
        <Box
          as="button"
          width="16px"
          height="16px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="full"
          color="fg.subtle"
          cursor="pointer"
          aria-label={`Remove ${entry.label} from query`}
          onClick={entry.remove}
          _hover={{ color: "fg", bg: "bg.subtle" }}
        >
          <Icon boxSize="10px">
            <X />
          </Icon>
        </Box>
      </HStack>
    </Tooltip>
  );
}
