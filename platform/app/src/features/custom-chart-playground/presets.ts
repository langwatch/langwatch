/**
 * Playground presets: each pairs a LangWatchQL statement (the SQL pane) with
 * author HTML (the frame). SQL never travels from the frame — these are the
 * two halves the planned CustomGraph kind stores together.
 */

export interface ChartPlaygroundPreset {
  readonly name: string;
  readonly sql: string;
  readonly html: string;
}

/** Bucketed trace counts — the canonical follows-everything statement. */
const BUCKETED_TRACES_SQL = `SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket,
  count() AS events
FROM traces
WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime}
GROUP BY bucket
ORDER BY bucket`;

const FULL_TOUR_HTML = `<div id="status">Booting…</div>
<div id="chart"></div>
<script>
  // Init-race regression check: this synchronous read at the very top of the
  // author script must be defined, because the shim only activates this
  // template after lw:init has set LW.params.
  var granularityAtLoad = LW.params.granularitySeconds;
  console.log("sync read at script top — granularitySeconds:", granularityAtLoad, "theme:", LW.theme);

  LW.setHeight(9999); // clamps to the 640px ceiling
  LW.setHeight(320);

  function render(result) {
    var status = document.getElementById("status");
    status.textContent =
      result.rows.length + " rows · " + result.statistics.elapsedMs + "ms" +
      (result.truncated ? " · truncated" : "") +
      (result.coarsenedFromSeconds ? " · coarsened from " + result.coarsenedFromSeconds + "s" : "");
    var head = result.columns.map(function (c) { return "<th style='text-align:left;padding:2px 8px'>" + c.name + "</th>"; }).join("");
    var body = result.rows.slice(0, 50).map(function (row) {
      return "<tr>" + result.columns.map(function (c) {
        return "<td style='padding:2px 8px;border-top:1px solid #ccc'>" + String(row[c.name]) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    document.getElementById("chart").innerHTML =
      "<table style='border-collapse:collapse;font-size:12px'><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function run() {
    LW.query({}).then(render, function (err) {
      document.getElementById("status").textContent = err.title + " [" + err.code + "]: " + err.message;
      LW.error(err.title);
    });
  }

  LW.onParamsChange(function (params) {
    console.log("params changed:", JSON.stringify(params));
    run();
  });

  run();
</script>`;

const ERROR_DEMO_HTML = `<div>Watch the log panel.</div>
<script>
  LW.error(new Error("An explicit LW.error call"));
  LW.query({}).then(
    function () { console.log("unexpectedly succeeded"); },
    function (err) { console.warn("query rejected:", err.code, "-", err.title); }
  );
  setTimeout(function () { undefinedFunctionCall(); }, 100); // uncaught → lw:error
  Promise.reject(new Error("an unhandled rejection"));
</script>`;

const RUNAWAY_HTML = `<div>Busy-looping for 3 seconds — the watchdog should tear this frame down at ~1.5s.</div>
<script>
  var end = Date.now() + 3000;
  while (Date.now() < end) { /* wedge the frame's event loop */ }
  console.log("survived the loop (watchdog missed)");
</script>`;

/** The SQL a freshly-created playground widget starts with. */
export const STARTER_WIDGET_SQL = BUCKETED_TRACES_SQL;

/** The author HTML a freshly-created playground widget starts with. */
export const STARTER_WIDGET_HTML = FULL_TOUR_HTML;

export const CHART_PLAYGROUND_PRESETS: readonly ChartPlaygroundPreset[] = [
  { name: "Full tour", sql: BUCKETED_TRACES_SQL, html: FULL_TOUR_HTML },
  {
    name: "Error demo",
    sql: "SELECT this is not valid LWQL",
    html: ERROR_DEMO_HTML,
  },
  { name: "Runaway", sql: BUCKETED_TRACES_SQL, html: RUNAWAY_HTML },
];
