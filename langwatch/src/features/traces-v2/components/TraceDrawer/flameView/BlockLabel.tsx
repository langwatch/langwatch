import { formatDuration } from "../../../utils/formatters";
import { formatPercent } from "./tree";

export function BlockLabel({
  name,
  duration,
  model,
  pctOfParent,
  widthPct,
}: {
  name: string;
  duration: number;
  model: string | null;
  pctOfParent: number | null;
  widthPct: number;
}) {
  if (widthPct < 2) return null;
  if (widthPct < 5) return <>{name.slice(0, 8)}</>;
  const dur = formatDuration(duration);
  const pct = pctOfParent !== null ? ` · ${formatPercent(pctOfParent)}` : "";
  if (widthPct >= 18 && model) {
    return (
      <>
        {name} ({dur}
        {pct}) · {model.split("/").pop()}
      </>
    );
  }
  if (widthPct >= 10) {
    return (
      <>
        {name} ({dur}
        {pct})
      </>
    );
  }
  if (widthPct >= 8) {
    return (
      <>
        {name} ({dur})
      </>
    );
  }
  return <>{name}</>;
}
