import { Badge } from "@langwatch/design-system/primitives";

const PALETTE: Record<string, "green" | "blue" | "yellow" | "red" | "gray"> = { GET: "green", POST: "blue", PUT: "yellow", PATCH: "yellow", DELETE: "red" };

export function MethodBadge({ method }: { method: string }) {
  return (
    <Badge size="sm" variant="subtle" colorPalette={PALETTE[method] ?? "gray"} fontFamily="mono" fontWeight="600">
      {method}
    </Badge>
  );
}
