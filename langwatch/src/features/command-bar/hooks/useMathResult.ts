import { useMemo } from "react";
import { Calculator } from "lucide-react";
import type { ListItem } from "../getIconInfo";
import type { Command } from "../types";

// Safe math evaluation (no eval)
function evaluateMath(expr: string): number | null {
  try {
    // Only allow: digits, +, -, *, /, (), ., spaces
    if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(expr)) return null;
    // Must contain at least one operator
    if (!/[\+\-\*\/]/.test(expr)) return null;
    // Use Function constructor for safer evaluation
    const result = new Function(`return (${expr})`)() as unknown;
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

export function useMathResult(query: string): ListItem | null {
  return useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 3) return null;

    const result = evaluateMath(trimmed);
    if (result === null) return null;

    // Format result nicely
    const formatted = Number.isInteger(result)
      ? result.toString()
      : result.toFixed(6).replace(/\.?0+$/, "");

    return {
      type: "command",
      data: {
        id: "computed-math",
        label: `${trimmed} = ${formatted}`,
        description: "Click to copy result",
        icon: Calculator,
        category: "actions",
      } as Command,
    };
  }, [query]);
}
