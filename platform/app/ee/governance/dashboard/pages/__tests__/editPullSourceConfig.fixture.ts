// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The composer state the edit-path suites start from.
 *
 * It lives outside them because the three suites that were split out of one
 * file all need the same starting point, and a copy per file is how they
 * would drift into testing three slightly different forms.
 */

import type { ComposerState } from "../ingestion-sources";

export function composer(
  parserConfig: Record<string, string>,
  pullSchedule = "",
): ComposerState {
  return {
    sourceType: "anthropic_admin",
    name: "Anthropic org spend",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule,
  };
}
