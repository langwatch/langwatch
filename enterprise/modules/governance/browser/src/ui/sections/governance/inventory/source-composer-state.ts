// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";

export interface ComposerState {
  sourceType: SourceType;
  name: string;
  description: string;
  parserConfig: Record<string, string>;
  /**
   * OTTL extraction statements applied by the aigateway before the
   * canonical extractor reads `langwatch.*` attributes. Only persisted
   * for OTTL-enabled source types (otel_generic + claude_code today);
   * pull-mode sources ignore.
   */
  ottlStatements: string[];
  /**
   * Cron override for puller-mode sources. Stays "" while the admin
   * leaves the Cadence picker untouched — meaning "the recommended
   * schedule", which `buildCreateInput` resolves to an explicit cron at
   * create (a stored null would mean the source never runs). Ignored
   * for push/webhook source types.
   */
  pullSchedule: string;
  /**
   * The project this source's conversations land in, or null for "don't
   * route" — which is also where it starts, deliberately. Where one team's
   * conversations become readable to another is a choice someone makes, not
   * a default they inherit. Only conversation-bearing source types offer it
   * (ADR-088 Decision 8); for the rest it stays null.
   */
  traceProjectId: string | null;
}

export const blankComposer = (): ComposerState => ({
  sourceType: "otel_generic",
  name: "",
  description: "",
  parserConfig: {},
  ottlStatements: [],
  pullSchedule: "",
  traceProjectId: null,
});
