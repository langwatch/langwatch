# The widget standard

Every dashboard widget follows these rules: first the card rules, then how a widget shows
missing data.

## Rules for every card

- **Get it in three seconds.** A busy manager understands the card at a glance: one big number,
  one comparison, a simple chart.
- **Rigour goes in the hover.** Sample size, intervals, provenance, definitions, method notes and
  coverage go behind the (i) or the hover. They never go on the card face.
- **No text walls.** No description line under the title, no footnotes, no generated sentences.
  A board has at most one short, specific headline.
- **Plain words.** Write "85% → 63%", never "-22.3 pts". Use no stats vocabulary.
- **Real names.** Use customer, topic, tool and model names. Never use codes such as t-07.
- **One time range per board.** A card's range never disagrees with the board's.
- **Numbers agree.** Two cards that show the same fact use the same window and the same rule.
- **Labels the product can derive.** Every label comes from data LangWatch has.
- **No invented ROI.** Show money value only when the project set value settings, and never as
  the headline.
- **4 to 6 cards a board.**
- **Every number opens its traces**, with the same filter.

## Missing data: the query reports it, the frame displays it

Every windowed LangWatchQL result carries a completeness report beside its rows
(`queryCompletenessSchema` in `modules/analytics/contract/src/analytics.lwql.ts`). Widget code
reads it from `LW.useChartQuery(...).completeness`. The widget never guesses coverage.

The widget frame (`ui/sections/dashboard-widget-frame.tsx`) watches every query the widget runs
and draws one of these states:

| State        | What the reader sees                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_access`  | What is withheld and who to ask, with a lock. See "No access" below.                                                                                                      |
| failed       | "Couldn't load <widget>", the reason, and Retry. Retry runs all the widget's queries again.                                                                               |
| `no_traffic` | "No traces in this period", naming what the query counts ("No evaluations ...").                                                                                          |
| `missing`    | The setup view: "Needs <field>", and "Ask Langy to help" when the board offers Langy.                                                                                     |
| `partial`    | The widget's own card, with a clean face. The (i) says what is missing: "Total cost on 400 of 1,000 traces. No price for my-finetune-v2 (600 traces)." and "Add a price". |
| `complete`   | The widget's own card.                                                                                                                                                    |

A widget with several queries shows one state for all of them:

- A query refused because the reader may not see what it reads puts the widget in `no_access`.
- A query that fails before it ever answered fails the widget, once the frame has stopped
  retrying it. A refresh that fails keeps the rows on screen.
- `no_traffic` only when every query found no traffic. A query with no report (one that reads
  outside the period, such as "has this source ever sent data") leaves the card to the widget,
  so it can offer to connect the source. A query over another window (last week,
  for a comparison) may be empty while the main one is not, so it never empties the card.
- Otherwise the worst state wins: `missing`, then `partial`, then `complete`.

So widget code does not draw its own error, no-traffic or setup face. It draws its loading state
and its chart.

A widget's hand-kept needs (`requirements` in the catalogue) keep only what no query can see,
such as a judge, a setting or a source to connect. A trace field the query reads is the query's
to report.

## No access: the board opens, the widget says what is withheld

A person who may not see some data still sees the board. The widget that shows that data keeps
its card, its title and its place in the grid, and its body says so. The server refuses a query
that reads a column or calls a function the person's role may not see, and names what they lack
(`missingGates` on each violation, `findLangWatchQLMissingGates` in the analytics contract). The
frame turns that refusal into this state. No widget handles it itself.

| State       | What the reader sees                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_access` | A lock, then what is withheld in plain words ("Cost figures are hidden for your role"), then who to ask ("Ask an admin of Checkout Agent if you need to see them."). |

- **It is not an error.** No red, no warning colour, no Retry, no error code and no query text.
- **Nothing leaks.** No figure, no chart, no column name. The card offers no Ask Langy, no
  "Edit with Langy", no alert and no report, because each would read the same data. "Edit code"
  stays only for a reader who may edit widgets (`analytics:update`).
- **The whole widget, not one column.** The server refuses a query as a whole, so a widget with
  one cost column among others is in this state. A widget with several queries is in it as soon
  as one of them is refused for access.
- **It comes first.** Before a failure, before "missing": a person who may not see cost is not
  told to retry, or to send cost.
- **It follows the reader, not the board.** The same board shows cost to a Member and this state
  to a Viewer or a Lite member, who do not hold `cost:view`.

The words are in `model/dashboard-widget/widget-access.ts`. Cost has its own line; any other
gate, such as captured input or output hidden by the project's data privacy settings, reads
"This data is hidden for your role".

## Never show missing as zero

The chart kit is `@langwatch/charts` in widget code (`model/dashboard-widget/chartsLib`).

- **Sums.** A sum that can only grow once the rest arrives is a lower bound. It gets a "+"
  ("$830+"), and the hover says why. Ask `isLowerBound({ completeness, field })`. Averages and
  rates never get a "+".
- **Unpriced cost.** Cost with no price is unknown, not $0. Pass `completeness.unpriced` to a
  `Leaderboard` (or `LwqlChart`): each model gets a "no price" row and "–" for its cost.
- **Averages.** An average divides by the rows that carry the field, so unpriced traces never
  pull a cost per trace down.
- **Buckets.** The report lists every bucket in the window, and empty ones have `n` 0.
  `mergeBuckets` merges them with the rows.
  - Each series declares its `kind`, `"count"` or `"measure"`. The default is `"measure"`,
    because it is the safe one.
  - A count over an empty bucket is a real 0.
  - A measure (a rate, an average or a percentile) over an empty bucket is a gap. In
    `AreaTimeseries` its area breaks, a faint dashed bridge joins the points either side, and
    the hover says "No data on Oct 7" or the widget's own words (`gapLabel`). A stacked area
    has no bridge.
- **Big numbers** never average in empty buckets: `averageOf({ rows, key, weight })` skips them.
- **Formatting.** Nothing turns null, NaN or undefined into 0 on the way to the screen.
  `toNumber` keeps null, and the kit prints "–" for a value it does not have.
- **Nothing to show.** A source that sent nothing says so ("No runs"), not "$0.00".
- **Cost coverage.** A row's cost counts as present only when the row carries a cost and no
  unpriced span. A project that sends no cost reads `missing` ("Needs total cost"), never $0.
- **Nothing to flag.** A widget whose job is to flag problems says so plainly when it finds
  none ("All costs priced", with a check), filling the card so it never reads as broken. The
  (i) says how much any whole-data widget checked: "Checked 1,880 traces in this period."
