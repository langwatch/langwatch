import { Text, VStack } from "@chakra-ui/react";
import { LuLayers } from "react-icons/lu";
import { Chip } from "../Chip";

/**
 * Attribute the ingestion path stamps on a trace whose trace id LangWatch
 * minted because the emitter sent no trace context at all. Read as a literal
 * string (not a shared constant) so this UI never takes a build dependency on
 * the ingestion module that produces it.
 *
 * Keyed ONLY on the trace-level marker: a real trace can carry a single
 * context-less record whose SPAN id we minted (`langwatch.span.synthetic`),
 * and that must never make the whole trace read as synthetic.
 */
const SYNTHETIC_TRACE_ATTR = "langwatch.trace.synthetic";
const DERIVED_FROM_ATTR = "langwatch.trace.derived_from";

/**
 * Badge shown on traces LangWatch assembled itself. Some tools ship their
 * records with no trace of their own (a logs exporter running without a
 * traces exporter), so LangWatch groups those records into one trace by a
 * shared key (a session or conversation id). The badge tells the reader the
 * grouping is LangWatch's, not the tool's, and names the key it grouped by.
 *
 * Renders nothing for ordinary traces.
 */
export function SyntheticTraceBadge({
  attributes,
}: {
  attributes: Record<string, string>;
}) {
  if (attributes[SYNTHETIC_TRACE_ATTR] !== "true") return null;

  const derivedFrom = attributes[DERIVED_FROM_ATTR]?.trim();

  // Explanation shown on hover, and mirrored onto the badge's accessible
  // label so screen readers and tests get the same "why". Names the grouping
  // key when we have it, stays general when we don't.
  const explanation = derivedFrom
    ? `These records arrived without a trace of their own, so LangWatch grouped them into one trace by ${derivedFrom}.`
    : "These records arrived without a trace of their own, so LangWatch grouped them into one trace.";

  const tooltip = (
    <VStack align="start" gap={1} maxWidth="280px">
      <Text textStyle="xs" fontWeight="medium">
        Grouped by LangWatch
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {explanation}
      </Text>
    </VStack>
  );

  return (
    <Chip
      icon={LuLayers}
      value="Grouped by LangWatch"
      tone="purple"
      tooltip={tooltip}
      ariaLabel={`Grouped by LangWatch. ${explanation}`}
    />
  );
}
