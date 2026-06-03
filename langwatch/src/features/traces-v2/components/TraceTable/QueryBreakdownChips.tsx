import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useMemo } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { walkAST } from "~/server/app-layer/traces/query-language/walk";
import { useFilterStore } from "../../stores/filterStore";

/**
 * Empty-state companion that breaks the active query down into removable
 * chips so a user can drop individual pieces without retyping the whole
 * thing. Shipped because we saw users typing junk into the search bar
 * (e.g. "Ω AND status:error") and being unable to figure out *why*
 * results were empty — the search bar showed the full string, the
 * sidebar showed a count of 1 active facet, but the noisy "Ω" was
 * invisible in both. This panel surfaces every clause as a chip so the
 * mistake is removable in one click.
 *
 * Predicate rendering rules:
 *   - Fielded tags  ("field:value") → chip with × that calls
 *     `removeFacet(field, value)`.
 *   - Range tags    ("duration:>1000") → chip with × that calls
 *     `removeField(field)` (range removal is whole-field, not per-bound,
 *     in the existing filterStore API).
 *   - Free-text     (ImplicitField literal) → chip with × that nukes
 *     just the offending token via `removeFreeText(value)`.
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
        if (isFielded) {
          // Fielded predicate — remove via `removeFacet(field, value)`.
          out.push({
            id: `f:${fieldName}:${value}:${negated ? "n" : "p"}`,
            label: `${negated ? "NOT " : ""}${fieldName}:${value}`,
            remove: () => removeFacet(fieldName, value),
          });
        } else {
          // Free-text — single-character ASCII letters/digits are fine
          // (most real queries are bare strings like `refund`); flag
          // anything non-ASCII or punctuation-heavy as a likely
          // accidental glyph (e.g. "Ω", "·", emoji). The chip's still
          // removable either way; the warn tone is just a hint.
          const looksAccidental = /[^\w\s.\-/_:'"`]/.test(value);
          out.push({
            id: `t:${freeTextIdx++}:${value}`,
            label: value,
            remove: () => removeFreeText(value),
            warn: looksAccidental,
          });
        }
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
        Active filters — click × on any chip to drop just that piece.
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
