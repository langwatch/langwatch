---
name: find-traces
user-prompt: "Find the traces where users gave a thumbs down"
description: Find the traces that match what the user describes, such as thumbs down, a user, an error, an evaluator label or a phrase. Drives the Trace Explorer when finding traces is the ask, and answers with result cards and a link when traces are a step in another task. Searches every form a concept can take before reporting that nothing matches. Use when asked to find, show, filter or count traces.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`. The live Trace Explorer actions need a Langy worker session; every other step works from any coding agent.
metadata:
  category: recipe
---

# Find Traces

A request to find traces names a concept ("thumbs down", "the angry ones", "alice's failures"), not a filter. This skill turns the concept into a filter in the trace filter language, runs it over the right window, and answers with the count and the traces.

## Prerequisites

## Primary and secondary way of working

Decide which one applies before you run anything.

**Primary: finding traces is the ask.** "Show me the thumbs down traces", "which traces failed yesterday", "filter to alice". The user wants to look at traces, so put them in front of the user: open the Trace Explorer and drive it with `explorer.setTimeRange` and `explorer.setFilter`. The Explorer is the answer; your reply is the count and what stands out.

**Secondary: traces are a means to another task.** "Build a dataset from the failed traces", "write a scenario from a bad conversation", "why is cost up" asked from another page. Stay on the page the user is on. Search with `langwatch trace search`, answer with its cards and the "View in Trace Explorer" link they carry, and continue the task. Do not navigate away from the user's work.

When the turn context says the current page is the Trace Explorer, the primary way applies to any trace-finding ask, even a small one, because the user is already looking at the list.

## Step 1: Take the window and the filter from the page

The turn context of the Trace Explorer carries `from`, `to` and `search and attribute filters`. Those are the defaults:

- Use that window. Pass it as `--start-date <from> --end-date <to>` on every `trace search` and `trace facets` call. With no page context, use the last 30 days, which is what the Explorer opens on.
- Keep the filter the user already applied unless the ask replaces it. To narrow it, call `explorer.setFilter` with `"mode": "add"`.
- Name no origin. A search that names no origin counts what the Explorer counts: every trace except Langy's own. Do not pass `--origin application`; it drops evaluation, simulation and playground traces the Explorer shows, and the two counts stop agreeing. Pass `--origin` or an `origin:` term only when the user names an origin.

## Step 2: Learn the fields before writing a filter

```bash
langwatch query reference --section trace-filter     # the language: fields, operators, examples
langwatch trace fields --format json                 # every field a filter can name
langwatch trace facets <field> --start-date <from> --end-date <to> --format json   # the values a field holds in this project
```

Read the reference once per session. Use `trace facets` every time the concept maps to a field whose values you have not seen, because values differ per project: an event named `thumbs_up_down` in one project is `feedback` in another.

If any of these three is refused as an unknown command or an unknown option, the CLI on this worker is older than this skill. Say that, name the command that was refused and the version `langwatch --version` reports, and stop: an older CLI cannot list the fields or filter the search, so a search that runs without them would answer "none found" for a project that has results.

## Step 3: Search every form the concept can take

A concept can be recorded in several places. One empty search says one form is empty, not that the traces do not exist. Before reporting that nothing was found, try each form that applies:

1. **Events.** `langwatch trace facets event` lists the event names in the window. Thumbs down is the predefined event `thumbs_up_down` with a vote of `-1`: `event:thumbs_up_down AND event.attribute.event.metrics.vote:-1`. A custom event may carry the same meaning under another name or attribute, so read the facet values rather than assuming the predefined one.
2. **Annotations.** Reviewers and end users also leave thumbs and comments as annotations: `langwatch trace facets annotation`, then `annotation:<value>`.
3. **Evaluator results.** A sentiment, satisfaction or quality evaluator may already label the concept: `langwatch trace facets evaluatorLabel`, `evaluatorVerdict:fail`, `evaluator:<name>`.
4. **Trace attributes and labels.** Applications often stamp their own field: `langwatch trace facets label`, and `langwatch trace facets` with no field, which lists every facet with its top values and the attribute keys in use. Filter on one with `trace.attribute.<key>:<value>`.
5. **The text itself.** A phrase search with `-q "<phrase>"` when the concept shows up in what the user or the agent wrote.
6. **A wider window.** When every form is empty in the page's window, run the best form again over 90 days. If it matches there, say so and offer the wider window; do not change the page's window without saying it.

Then check the result is what it claims to be: read three of the matched traces with `langwatch trace get <traceId>` and confirm they show the concept. A filter that matches the wrong thing is worse than an empty one.

Ask the user only when two forms both match and mean different things (an end user's thumbs down event versus a reviewer's negative annotation). Say what each one counts and ask which they mean. When one form matches, use it and say which form it was.

## Step 4a: Primary, drive the Explorer

```bash
langwatch navigate open traces                  # only when the user is on another page; run it alone
langwatch ui actions                            # confirm the explorer.* kinds and read their payload schemas
langwatch ui call explorer.setTimeRange --payload '{"preset":"30d"}'      # only when the window has to change
langwatch ui call explorer.setFilter --payload-file filter.json
langwatch ui call explorer.getState --payload '{}'
```

`filter.json` holds `{"query": "<the filter>"}`. Write it to a file: a filter has quotes and colons the shell would split.

`explorer.getState` answers what the page shows: `query`, `timeRange`, `totalHits`, `pageTraceIds` and `source`. Report `totalHits`, because it is the number on the user's screen. When `isCountSettled` is `false` the list has not answered yet; read the state once more before you report a count.

Read `executedVia` on every call. `"browser"` means the Explorer on screen changed. `"backend"` means no Explorer was open: the answer carries `href` and the card shows "View in Trace Explorer" on that filter, and the page did not change. In that case take the count from `langwatch trace search` with the same filter and window, and tell the user the link opens the Explorer on it.

A state with `source: "saved"` carries a `note` and the Explorer's defaults, not the user's screen: do not quote its query, window or count as theirs. Say "this is not the page you are on" and give the link, rather than a number you did not read from a page. A call that fails with `langy_ui_page_not_ready` reached a page that was still loading. In both cases run the same call once more before you answer, and take the count from `langwatch trace search` with the same filter and window when the second call answers `saved` too.

`explorer.setFilter` refuses a filter the language does not parse with `filter_invalid` and a position. Fix the filter and call once more.

Other kinds, for follow-up asks: `explorer.setLens`, `explorer.setSort`, `explorer.setPage`, `explorer.select`, and `explorer.runInstantEval` for a judgement no field holds ("which of these sound annoyed"). `explorer.runInstantEval` spends the user's budget and needs an open Explorer, so use it when the fields and events above cannot express the concept.

## Step 4b: Secondary, answer with cards

```bash
langwatch trace search --filter '<the filter>' --start-date <from> --end-date <to> --limit 25 --format json
```

The card lists the traces and links to the Explorer on the same filter and window, so the count the user sees after the click is the count you reported. Report `.pagination.totalHits`, not the number of rows on the page. Then continue the task the traces were for.

## What to report

- The count, the window it covers, and which form matched ("1,204 traces in the last 30 days carry a thumbs down event").
- Two or three things the matched traces have in common, from the ones you read.
- When nothing matched: every form you tried and the window, in one sentence, so the user knows the search was complete.

## Common mistakes

- Reporting "no traces found" after one empty search. Run the forms in Step 3 first.
- Passing `--origin application` by habit. The count then disagrees with the Explorer.
- Using the 24 hour CLI default while the user looks at 30 days. Pass the page's window.
- Driving the Explorer away from a task the user is in the middle of. That is the secondary way: cards and a link.
- Saying the page shows something when `executedVia` was `"backend"`.
