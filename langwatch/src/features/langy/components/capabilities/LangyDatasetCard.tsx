/**
 * Dataset capability card (`platform_list_datasets`, `platform_get_dataset`,
 * `platform_list_dataset_records`).
 *
 * Summarises what a dataset read returned — a count plus the first few named
 * rows — and links into Datasets. Read-only. (A dataset CREATE is a write and
 * renders through the resource-result card / staged proposal instead.)
 */
import { Text, VStack } from "@chakra-ui/react";
import {
  extractPrimaryId,
  extractToolText,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import { CapabilityRow, LangyCapabilityCard } from "./LangyCapabilityCard";

function parseDataset(output: unknown): {
  count: number | null;
  names: string[];
} {
  const text = extractToolText(output);
  const countMatch = text.match(/(\d+)\s+(?:records?|datasets?|rows?)/i);
  const count = countMatch ? Number(countMatch[1]!) : null;

  // Pull bullet / numbered / pipe-table names heuristically.
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    const cells = trimmed.startsWith("|")
      ? trimmed.split("|").map((c) => c.trim()).filter(Boolean)
      : null;
    if (bullet) names.push(bullet[1]!.replace(/\*\*/g, ""));
    else if (cells && cells.length > 0 && !/^-+$/.test(cells[0]!)) {
      if (cells[0]!.toLowerCase() !== "name" && cells[0]!.toLowerCase() !== "date")
        names.push(cells[0]!);
    }
    if (names.length >= 5) break;
  }
  return { count, names };
}

export function LangyDatasetCard({
  descriptor,
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const id = extractPrimaryId(input, output);
  const { count, names } = parseDataset(output);
  const title =
    count != null
      ? `${count.toLocaleString()} ${count === 1 ? "record" : "records"}`
      : descriptor.overline;

  return (
    <LangyCapabilityCard
      tone="read"
      surface="datasets"
      overline={descriptor.overline}
      title={title}
      projectSlug={projectSlug}
      resourceId={id}
    >
      {names.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {names.map((name, i) => (
            <CapabilityRow key={`${name}-${i}`} primary={name} />
          ))}
        </VStack>
      ) : (
        <Text textStyle="xs" color="fg.muted">
          {count === 0 ? "No records." : "Dataset read."}
        </Text>
      )}
    </LangyCapabilityCard>
  );
}
