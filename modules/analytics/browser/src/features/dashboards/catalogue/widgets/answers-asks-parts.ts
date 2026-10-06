/**
 * Helper snippets the Answer quality and What users ask widgets share, on top of the
 * template parts: topic names, a labelled share row and a sparkline. Each reads `PALETTE`
 * and `NUMBERS`, as every stored widget carries its own copy.
 */

/** A topic as people read it; a conversation without one says so. */
export const TOPIC_NAME = `const topicName = (value) =>
  value ? String(value).charAt(0).toUpperCase() + String(value).slice(1) : "No topic";`;

/** One labelled bar per row: label and figure on a line, the bar, then an optional note. */
export const SHARE_ROWS = `// value: bar length, 0 to 1 of the widest; note, colour, title optional
function ShareRows({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row) => (
        <div key={row.label} title={row.title}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 500, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.label}
            </span>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {row.figure}
            </span>
          </div>
          <div style={{ height: 6, marginTop: 2, borderRadius: 3, background: C.muted }}>
            <div style={{ height: "100%", borderRadius: 3, opacity: 0.8,
              width: Math.min(1, row.value) * 100 + "%", background: row.colour || C.orange }} />
          </div>
          {row.note ? <div style={{ marginTop: 2, fontSize: 11, color: C.subtle,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.note}</div> : null}
        </div>
      ))}
    </div>
  );
}`;

/** A small line of values over time; a missing value breaks nothing, it is skipped. */
export const SPARK = `function Spark({ values, colour, width = 72, height = 22 }) {
  const known = values.filter((value) => value !== null);
  if (known.length < 2) return <span style={{ width }} />;
  const top = Math.max(...known);
  const bottom = Math.min(...known);
  const step = width / Math.max(1, values.length - 1);
  const y = (value) => height - 2 - ((value - bottom) / (top - bottom || 1)) * (height - 4);
  const points = values
    .map((value, index) => (value === null ? null : index * step + "," + y(value)))
    .filter(Boolean)
    .join(" ");
  return (
    <svg width={width} height={height} style={{ flexShrink: 0 }}>
      <polyline points={points} fill="none" stroke={colour} strokeWidth="1.5" />
    </svg>
  );
}`;
