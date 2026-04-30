/**
 * Fields that are read identically by both the trace summary repository
 * (single-trace fetch) and the trace list repository (paginated list).
 *
 * Both repositories project the same `trace_summaries` table — the only
 * differences are: the list path projects `Attributes` map keys into
 * dedicated columns for fast scans, while the summary path returns the
 * full `Attributes` map plus `Events.*` arrays. These shared fields
 * cover everything else.
 */
export interface TraceSummaryFieldsBase {
  TraceId: string;
  TenantId: string;
  OccurredAt: number;
  CreatedAt: number;
  UpdatedAt: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: number;
  ContainsOKStatus: number;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  OutputFromRootSpan: number;
  OutputSpanEndTimeMs: number;
  BlockedByGuardrail: number;
  RootSpanType: string | null;
  ContainsAi: number;
  TraceName: string;
  ContainsPrompt: number;
  SelectedPromptId: string | null;
  SelectedPromptSpanId: string | null;
  LastUsedPromptId: string | null;
  LastUsedPromptVersionNumber: number | null;
  LastUsedPromptVersionId: string | null;
  LastUsedPromptSpanId: string | null;
  TopicId: string | null;
  SubTopicId: string | null;
  AnnotationIds: string[];
  ScenarioRoleCosts: Record<string, number>;
  ScenarioRoleLatencies: Record<string, number>;
  ScenarioRoleSpans: Record<string, string>;
  SpanCosts: Record<string, number>;
}
