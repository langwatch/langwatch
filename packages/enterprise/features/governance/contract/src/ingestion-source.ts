import { z } from "zod";

export const OTTL_ENABLED_SOURCE_TYPES = ["otel_generic"] as const;
export const ottlEnabledSourceTypeSchema = z.enum(OTTL_ENABLED_SOURCE_TYPES);
export type OttlEnabledSourceType = z.infer<typeof ottlEnabledSourceTypeSchema>;

/**
 * Platform-known tools use native extractors. Only the generic OTLP source
 * exposes the custom OTTL editor, and it deliberately starts empty.
 */
export function getStarterTemplate(_sourceType: string): readonly string[] {
  return [];
}

export function isOttlEnabledSourceType(sourceType: string): sourceType is OttlEnabledSourceType {
  return ottlEnabledSourceTypeSchema.safeParse(sourceType).success;
}
