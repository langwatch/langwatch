/**
 * The builds of the org Flight deck, keyed by catalogue widget id. Both run their queries once
 * per project the member can see, and share the same statements so each project is asked once.
 */

import * as code from "./flight-deck-org-code.ts";
import * as sql from "./flight-deck-org-queries.ts";
import type { CatalogueWidgetBuild } from "./index.ts";

const DECK_QUERIES = {
  agents: sql.DECK_AGENTS_SQL,
  lastSeen: sql.DECK_LAST_SEEN_SQL,
  evaluations: sql.DECK_EVALUATIONS_SQL,
  gaps: sql.DECK_FIELD_GAPS_SQL,
};

export const FLIGHT_DECK_ORG_BUILDS: Readonly<Record<string, CatalogueWidgetBuild>> = {
  "fd-org-attention": {
    code: code.ORG_ATTENTION_CODE,
    queries: DECK_QUERIES,
    width: "full",
    rows: 8,
    scope: "organization",
  },
  "fd-org-agents": {
    code: code.ORG_AGENTS_CODE,
    queries: DECK_QUERIES,
    width: "full",
    rows: 9,
    scope: "organization",
  },
  "fd-org-quality": {
    code: code.ORG_QUALITY_CODE,
    queries: { trend: sql.DECK_QUALITY_TREND_SQL },
    width: "full",
    rows: 6,
    scope: "organization",
  },
  "fd-org-behaviour": {
    code: code.ORG_BEHAVIOUR_CODE,
    queries: { ...DECK_QUERIES, tools: sql.DECK_TOOLS_SQL },
    width: "full",
    rows: 7,
    scope: "organization",
  },
  "fd-org-value": {
    code: code.ORG_VALUE_CODE,
    queries: { spend: sql.DECK_SPEND_TREND_SQL, resolved: sql.DECK_RESOLVED_SQL },
    width: "full",
    rows: 10,
    scope: "organization",
  },
};
