/**
 * Traces capability card (`search_traces`, `get_trace`).
 *
 * A trace search renders a row list — one row per matched trace, each linking
 * to that trace — under a "Found N traces" header. A single-trace lookup
 * renders a one-trace summary. Both are reads: no Apply, just the results and
 * the "Open in Traces" deep link.
 */
import { Text, VStack } from "@chakra-ui/react";
import {
  buildSurfaceHref,
  extractPrimaryId,
  extractToolText,
  summaryLines,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { CapabilityRow, LangyCapabilityCard } from "./LangyCapabilityCard";

interface ParsedTrace {
  id: string;
  snippet?: string;
}

function parseTraces(output: unknown): {
  total: number | null;
  traces: ParsedTrace[];
} {
  const text = extractToolText(output);
  const totalMatch = text.match(/Found\s+([\d,]+)\s+traces/i);
  const total = totalMatch ? Number(totalMatch[1]!.replace(/,/g, "")) : null;

  const traces: ParsedTrace[] = [];
  const blocks = text.split(/^###\s+Trace:\s*/m).slice(1);
  for (const block of blocks) {
    const idMatch = block.match(/^([A-Za-z0-9_-]+)/);
    if (!idMatch) continue;
    const id = idMatch[1]!;
    const inputLine = block.match(/\*\*Input\*\*:\s*(.+)/);
    const snippet = inputLine ? inputLine[1]!.trim() : undefined;
    traces.push({ id, snippet });
  }
  return { total, traces };
}

export function LangyTracesCard({
  descriptor,
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const isSingle = descriptor.render === "trace";

  if (isSingle) {
    const id = extractPrimaryId(input, output);
    const lines = summaryLines(output, 4);
    return (
      <LangyCapabilityCard
        tone="read"
        surface="traces"
        overline="Trace"
        title={id ? `Trace ${id.slice(0, 10)}` : "Trace"}
        projectSlug={projectSlug}
        resourceId={id}
      >
        {lines.length > 0 ? (
          <VStack align="stretch" gap={0.5}>
            {lines.map((line, i) => (
              <Text key={i} textStyle="xs" color="fg.muted" lineHeight="1.45">
                {line}
              </Text>
            ))}
          </VStack>
        ) : null}
      </LangyCapabilityCard>
    );
  }

  const { total, traces } = parseTraces(output);
  const shown = traces.slice(0, 6);
  const remaining = (total ?? traces.length) - shown.length;

  return (
    <LangyCapabilityCard
      tone="read"
      surface="traces"
      overline="Traces"
      title={
        total != null
          ? `${total.toLocaleString()} ${total === 1 ? "trace" : "traces"}`
          : `${traces.length} traces`
      }
      projectSlug={projectSlug}
    >
      {shown.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {shown.map((trace) => (
            <CapabilityRow
              key={trace.id}
              href={buildSurfaceHref({
                surface: "traces",
                projectSlug,
                resourceId: trace.id,
              })}
              primary={trace.id}
              secondary={trace.snippet}
            />
          ))}
          {remaining > 0 ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
              +{remaining.toLocaleString()} more
            </Text>
          ) : null}
        </VStack>
      ) : (
        <Text textStyle="xs" color="fg.muted">
          No traces matched.
        </Text>
      )}
    </LangyCapabilityCard>
  );
}
