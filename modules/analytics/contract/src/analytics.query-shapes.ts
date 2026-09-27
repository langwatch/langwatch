export interface BuiltAnalyticsQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}
