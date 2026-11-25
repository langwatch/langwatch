// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { useState } from "react";

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import type { Source } from "../ingestion-source-forms.ts";
import { seedComposerParserConfig, seedPullSchedule } from "./source-submission.ts";

/** The edit form's starting values, read off the stored row. */
function seedSourceEditForm(source: Source) {
  const parser = (source.parserConfig as Record<string, unknown>) ?? {};
  const raw = parser.ottlStatements;
  return {
    name: source.name,
    description: source.description ?? "",
    statements: Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [],
    parserConfig: seedComposerParserConfig({
      sourceType: source.sourceType as SourceType,
      storedParserConfig: parser,
    }),
    // The column first, because it is the one the lifecycle runs on; the
    // adapter's copy inside parserConfig is a duplicate. See `seedPullSchedule`.
    pullSchedule: seedPullSchedule({
      pullSchedule: source.pullSchedule,
      storedParserConfig: parser,
    }),
  };
}

/**
 * The edit form's local state, seeded from the row each time the drawer opens
 * on a different source, including the trace destination.
 *
 * Split out from the drawer because seeding is the half with the reasoning in
 * it — which fields the row can answer, and which the DTO deliberately cannot
 * — while `SourceEditDrawer` (`source-edit-drawer.tsx`) is chrome. Keeping them in one function meant every
 * read of the markup scrolled past the seeding rules first.
 */
export function useSourceEditForm(source: Source | null) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [statements, setStatements] = useState<string[]>([]);
  const [parserConfig, setParserConfig] = useState<Record<string, string>>({});
  const [pullSchedule, setPullSchedule] = useState("");
  /**
   * `undefined` until the admin touches the picker — see
   * {@link buildEditSubmission} for why an untouched destination must not be
   * echoed back to a server that would re-validate it.
   */
  const [destination, setDestination] = useState<string | null | undefined>(undefined);

  // Seeded once per source id, during render: a re-render that hands back an
  // equal row must not discard what the admin has typed since the drawer opened.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!source && seededFor !== null) setSeededFor(null);
  if (source && source.id !== seededFor) {
    const seed = seedSourceEditForm(source);
    setSeededFor(source.id);
    setName(seed.name);
    setDescription(seed.description);
    setDestination(undefined);
    setStatements(seed.statements);
    setParserConfig(seed.parserConfig);
    setPullSchedule(seed.pullSchedule);
  }

  return {
    name,
    setName,
    description,
    setDescription,
    statements,
    setStatements,
    parserConfig,
    setParserConfig,
    pullSchedule,
    setPullSchedule,
    destination,
    setDestination,
  };
}
