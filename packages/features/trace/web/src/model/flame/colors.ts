import { SPAN_TYPE_COLORS } from "../display-formatters";

const spanColors: Readonly<Record<string, string>> = SPAN_TYPE_COLORS;

export function getSpanColor(type: string | null): string {
  return spanColors[type ?? "span"] ?? spanColors.span ?? "gray.solid";
}
