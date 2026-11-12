/**
 * The built widgets of the Answer quality and What users ask boards, keyed by catalogue id.
 * Outcomes come from the app's `metadata.outcome` or the outcome judge, topics from topic
 * clustering or the app's `metadata.topic`; see the queries file for each read.
 */

import { TABLE_ROWS } from "../../templates/model/template-widget.ts";
import * as code from "./answer-quality-code.ts";
import * as sql from "./answers-asks-queries.ts";
import type { CatalogueWidgetBuild } from "./index.ts";
import * as asks from "./what-users-ask-code.ts";

const CHART = 6;
const LIST = 5;

export const ANSWERS_ASKS_WIDGET_BUILDS: Readonly<Record<string, CatalogueWidgetBuild>> = {
  "ans-outcomes": {
    code: code.OUTCOMES_CODE,
    queries: {
      trend: sql.OUTCOME_TREND_SQL,
      totals: sql.OUTCOME_TOTALS_SQL,
      reasons: sql.OUTCOME_REASONS_SQL,
    },
    width: "full",
    rows: CHART,
  },
  "ans-idk": {
    code: code.UNANSWERED_CODE,
    queries: { topics: sql.UNANSWERED_TOPICS_SQL, trend: sql.UNANSWERED_TREND_SQL },
    width: "full",
    rows: LIST,
  },
  "so-agreement": {
    code: code.JUDGE_AGREEMENT_CODE,
    queries: { weekly: sql.JUDGE_AGREEMENT_SQL },
    width: "half",
    rows: CHART,
  },
  "ans-review": {
    code: code.REVIEW_QUEUE_CODE,
    queries: { flagged: sql.REVIEW_FLAGGED_SQL, audit: sql.REVIEW_AUDIT_SQL },
    width: "half",
    rows: TABLE_ROWS,
  },
  "rag-failure-source": {
    code: code.FAILURE_SOURCE_CODE,
    queries: { trend: sql.FAILURE_SOURCE_SQL },
    width: "half",
    rows: CHART,
  },
  "rag-empty-retrieval": {
    code: code.EMPTY_RETRIEVAL_CODE,
    queries: { trend: sql.EMPTY_RETRIEVAL_SQL },
    width: "half",
    rows: CHART,
  },
  "ask-cannot": {
    code: asks.CANNOT_SERVE_CODE,
    queries: { topics: sql.CANNOT_SERVE_SQL, totals: sql.CANNOT_SERVE_TOTALS_SQL },
    width: "half",
    rows: LIST,
  },
  "ask-rising": {
    code: asks.RISING_TOPICS_CODE,
    queries: { shares: sql.TOPIC_SHARES_SQL, daily: sql.TOPIC_DAILY_SQL },
    width: "half",
    rows: LIST,
  },
  "ans-topics": {
    code: asks.TOPIC_QUALITY_CODE,
    queries: { topics: sql.TOPIC_QUALITY_SQL },
    width: "full",
    rows: TABLE_ROWS,
  },
  "ask-again": {
    code: asks.ASKED_AGAIN_CODE,
    queries: { trend: sql.ASKED_AGAIN_SQL, users: sql.RETURNING_USERS_SQL },
    width: "half",
    rows: CHART,
  },
};
