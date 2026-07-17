/**
 * Dataset capability card (`platform_list_datasets`, `platform_get_dataset`,
 * `platform_list_dataset_records`).
 *
 * Summarises what a dataset read returned — a count plus the first few named
 * rows — and links into Datasets. Read-only. (A dataset CREATE is a write and
 * renders through the resource-result card / staged proposal instead.)
 */
import { Text, VStack } from "@chakra-ui/react";
import { useCapabilityData } from "../../hooks/useCapabilityData";
import {
  extractPrimaryId,
  extractToolText,
  type CapabilityCardInput,
} from "./capabilityRegistry";
import {
  CapabilityRow,
  CapabilityRowSkeletons,
  LangyCapabilityCard,
} from "./LangyCapabilityCard";
import { asJsonDocument } from "@langwatch/cli-cards";
import { collectionOf, totalOf } from "./cliResultDocument";

function parseDataset(output: unknown): {
  count: number | null;
  names: string[];
} {
  const document = asJsonDocument(output);
  const rows = document ? collectionOf(document) : null;
  if (rows) {
    const names = rows
      .flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const value = row as Record<string, unknown>;
        const name = value.name ?? value.slug ?? value.handle ?? value.id;
        return typeof name === "string" && name.trim() ? [name.trim()] : [];
      })
      .slice(0, 5);
    return {
      count: totalOf(document) ?? rows.length,
      names,
    };
  }
  const text = extractToolText(output);
  const countMatch = text.match(/(\d+)\s+(?:records?|datasets?|rows?)/i);
  const count = countMatch ? Number(countMatch[1]!) : null;

  // Pull bullet / numbered / pipe-table names heuristically.
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    const cells = trimmed.startsWith("|")
      ? trimmed
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
      : null;
    if (bullet) names.push(bullet[1]!.replace(/\*\*/g, ""));
    else if (cells && cells.length > 0 && !/^-+$/.test(cells[0]!)) {
      if (
        cells[0]!.toLowerCase() !== "name" &&
        cells[0]!.toLowerCase() !== "date"
      )
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
  digest,
  projectSlug,
}: CapabilityCardInput) {
  const id = extractPrimaryId(input, output);
  const { count, names } = parseDataset(output);

  // Hydrate the referenced datasets fresh, with the viewer's session. Idle
  // (sub-entity reads like `dataset records`, old turns, no digest) falls
  // back to the stored-output parse below.
  const hydration = useCapabilityData({ digest: digest ?? null });

  if (hydration.status !== "idle") {
    const total = hydration.totalCount ?? digest?.counts?.returned ?? null;
    const title =
      digest?.name ??
      (total !== null
        ? `${total.toLocaleString()} ${total === 1 ? "dataset" : "datasets"}`
        : descriptor.overline);
    return (
      <LangyCapabilityCard
        tone="read"
        surface="datasets"
        overline={descriptor.overline}
        title={title}
        projectSlug={projectSlug}
        resourceId={digest?.primaryId ?? id}
      >
        {hydration.isHydrating && hydration.rows.length === 0 ? (
          <CapabilityRowSkeletons
            count={Math.min(digest?.counts?.returned ?? 3, 5)}
          />
        ) : hydration.rows.length > 0 ? (
          <VStack align="stretch" gap={0}>
            {hydration.rows.map((row) => (
              <CapabilityRow
                key={row.id}
                primary={row.primary ?? row.id}
                secondary={row.secondary}
              />
            ))}
          </VStack>
        ) : (
          <Text textStyle="xs" color="fg.muted">
            {hydration.status === "unavailable"
              ? "Couldn't load these datasets right now — open Datasets to see them."
              : (digest?.counts?.returned ?? 0) === 1
                ? "This dataset is no longer available."
                : "These datasets are no longer available."}
          </Text>
        )}
      </LangyCapabilityCard>
    );
  }

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
