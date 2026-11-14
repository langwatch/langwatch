import { Badge } from "@langwatch/design-system/primitives";

const PALETTE: Record<string, "green" | "blue" | "yellow" | "red" | "gray"> = {
  GET: "green",
  POST: "blue",
  PUT: "yellow",
  PATCH: "yellow",
  DELETE: "red",
};

export function MethodBadge({ method }: { method: string }) {
  return (
    <Badge
      className="docs-method-badge"
      data-method={method}
      size="sm"
      variant="subtle"
      colorPalette={PALETTE[method] ?? "gray"}
      borderRadius="md"
      borderWidth="1px"
      fontFamily="mono"
      fontWeight="600"
    >
      {method}
    </Badge>
  );
}
