import { z } from "zod";

export const STATUSES = ["works", "broken", "blocked", "untested"] as const;

const journeyResultSchema = z.object({
  goal: z.string(),
  status: z.enum(STATUSES),
  reason: z.string(),
  run: z.string(),
  evidence: z.object({
    screens: z.array(z.string()),
    held: z.array(z.string()),
    failing: z.array(z.string()),
  }),
});

export const mapSchema = z.object({
  url: z.string(),
  features: z.record(z.string(), z.record(z.string(), journeyResultSchema)),
});

export type JourneyResult = z.infer<typeof journeyResultSchema>;
export type ProductMap = z.infer<typeof mapSchema>;

/** mergeMaps lays a run over the map so far: a journey it walked is replaced, the rest stay. */
export const mergeMaps = ({
  previous,
  next,
}: {
  previous: ProductMap;
  next: ProductMap;
}): ProductMap => {
  const features = { ...previous.features };
  for (const [feature, journeys] of Object.entries(next.features)) {
    features[feature] = { ...features[feature], ...journeys };
  }
  return { url: next.url, features };
};

const ICON: Record<JourneyResult["status"], string> = {
  works: "✅",
  broken: "❌",
  blocked: "⛔",
  untested: "⬜",
};

/** counts are one feature's journeys per status. */
export const counts = (
  journeys: Record<string, JourneyResult>,
): Record<JourneyResult["status"], number> => {
  const tally = { works: 0, broken: 0, blocked: 0, untested: 0 };
  for (const journey of Object.values(journeys)) tally[journey.status]++;
  return tally;
};

/**
 * renderMap is map.md: every catalogue feature, walked or not, so what still
 * needs doing is on the page beside what works.
 */
export const renderMap = ({
  map,
  featureIds,
}: {
  map: ProductMap;
  featureIds: string[];
}): string => {
  const ids = [...new Set([...featureIds, ...Object.keys(map.features)])].toSorted();
  const lines = [
    `# Interaction map (${map.url})`,
    "",
    "| feature | works | broken | blocked | untested |",
    "|---|---|---|---|---|",
  ];
  for (const id of ids) {
    const journeys = map.features[id] ?? {};
    const tally = counts(journeys);
    const walked = Object.keys(journeys).length > 0;
    lines.push(
      walked
        ? `| ${id} | ${tally.works} | ${tally.broken} | ${tally.blocked} | ${tally.untested} |`
        : `| ${id} | | | | not walked |`,
    );
  }
  for (const id of ids) {
    const journeys = Object.entries(map.features[id] ?? {});
    if (journeys.length === 0) continue;
    lines.push("", `## ${id}`, "");
    for (const [journeyId, journey] of journeys) {
      const proof = journey.status === "works" ? journey.evidence.held : journey.evidence.failing;
      lines.push(
        `- ${ICON[journey.status]} **${journeyId}**: ${journey.goal}. ${journey.reason}` +
          (proof.length > 0 ? ` (${proof.slice(0, 3).join("; ")})` : "") +
          ` [${journey.run}]`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

const SIM_FRAGMENT = /(?:\s*·\s*)?sim: [^|]*/;

const stateOf = (tally: ReturnType<typeof counts>): string => {
  if (tally.broken > 0) return "❌";
  return tally.works > 0 && tally.untested === 0 ? "🟢" : "🟡";
};

/** publishRow updates, or adds, one feature's row of the features table in place. */
const publishRow = ({
  rows,
  feature,
  tally,
}: {
  rows: string[];
  feature: string;
  tally: ReturnType<typeof counts>;
}): void => {
  const summary = `sim: ${tally.works} works, ${tally.broken} broken, ${tally.blocked} blocked, ${tally.untested} untested`;
  const index = rows.findIndex((row) => {
    const area = row.split("|")[1]?.trim().toLowerCase() ?? "";
    return area === feature || area === `${feature}s` || area.startsWith(`${feature} `);
  });
  if (index < 0) {
    rows.push(`| ${feature} | ${stateOf(tally)} | ${summary} | |`);
    return;
  }
  const cells = (rows[index] ?? "").split("|");
  const kept = (cells[3] ?? "").replace(SIM_FRAGMENT, "").trim();
  cells[3] = ` ${kept === "" ? summary : `${kept} · ${summary}`} `;
  rows[index] = cells.join("|");
};

/**
 * publishFeatures writes each walked feature's tally into the parity-status `### features`
 * table: a matching area's `proven live` cell gets a `sim: ...` fragment, replaced on the
 * next publish; a feature with no row gets one. Everything else stays as it was.
 */
export const publishFeatures = ({ body, map }: { body: string; map: ProductMap }): string => {
  const start = body.indexOf("<!-- parity-status:start -->");
  const end = body.indexOf("<!-- parity-status:end -->");
  if (start < 0 || end < start) return body;
  const section = body.slice(start, end).split("\n");
  const heading = section.findIndex((line) => line.trim() === "### features");
  if (heading < 0) return body;
  const tableStart = section.findIndex((line, index) => index > heading && line.startsWith("|"));
  if (tableStart < 0) return body;
  let tableEnd = tableStart;
  while (section[tableEnd + 1]?.startsWith("|")) tableEnd++;
  const rows = section.slice(tableStart + 2, tableEnd + 1);
  for (const [feature, journeys] of Object.entries(map.features)) {
    publishRow({ rows, feature, tally: counts(journeys) });
  }
  section.splice(tableStart + 2, tableEnd - tableStart - 1, ...rows);
  return body.slice(0, start) + section.join("\n") + body.slice(end);
};
