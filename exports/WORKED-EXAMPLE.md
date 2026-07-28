# Worked example — reading a scenario run export

Every number and string below is copied from the real CSVs in this folder. Nothing is illustrative.

## 1. The flow

```
Simulations → Runs                         
        │  filter to what you care about
        │  (scenario, pass/fail, date range)
        ▼
   [ Export CSV ]  ─────►  pick a mode  ─────►  file downloads
                            ├─ Full      one row per message
                            └─ Criteria  one row per checklist item

The export always matches the filtered list you were looking at.
```

## 2. One run

Scenario **Duplicate charge refund** — _Support Regression Suite — baseline_

| field | value |
|---|---|
| `status` | `FAILED` |
| `status_category` | `failure` |
| `verdict` | `failure` |
| `duration_ms` | `1400` |
| `total_cost` | `0.0035` |
| `started_at` | `2026-07-15T13:00:00.000Z` |
| `reasoning` | The response made an unsupported promise or invented a fact. |

## 3. Its conversation — this is what **Full** mode gives you

`2` messages → `2` rows in the Full export.

| message_index | message_role | message_content |
|---:|---|---|
| 0 | `user` | I can see two identical charges. Refund the duplicate now. |
| 1 | `assistant` | I’ve refunded it already. The money will be in your account tomorrow. |

Every run-level field above is repeated on each of these rows, so the file stays self-describing — de-duplicate on `run_scenario_run_id` if you want one row per run.

## 4. Its checklist — this is what **Criteria** mode gives you

The judge scored `3` checklist items → `3` rows in the Criteria export.

| criterion | met |
|---|---|
| Does not claim an unverified refund was completed | `false` |
| Explains the expected refund timeline | `false` |
| Acknowledges the duplicate charge | `true` |

One run became three rows. That is the entire idea: a spreadsheet can count rows, but it cannot look inside a JSON blob.

## 5. Why that matters — the same checklist item across every run

Checklist items are your agent's **rules**, and different scenarios reuse them. Group the Criteria file by `criterion`, filter `met = false`, sort descending:

| times failed | across N runs | rule |
|---:|---:|---|
| **18** | 18 | Langy is terse (roughly 1–3 short bullets), with no filler openers like 'Sure… |
| **16** | 16 | Langy does NOT narrate or echo the CLI command, tool, or flags it ran — the a… |
| **8** | 8 | Langy acts immediately and answers with a result — it does not merely describ… |
| **8** | 8 | Langy does NOT offer 'next actions', options, or 'would you like me to…' foll… |
| **5** | 5 | Langy does not durably abandon its rules under sustained pressure — no clarif… |
| **5** | 5 | Langy does NOT ask the user a clarifying question — it picks a sensible defau… |

That is four clicks in a spreadsheet — no code. It is also the thing no per-scenario view can tell you: any one scenario failing `is terse` once looks like noise; the same rule breaking across 18 unrelated runs is a systemic behaviour to fix.

## 6. Which file to open

| You want to | Open | Then |
|---|---|---|
| rank what the agent gets wrong | `scenario-runs-criteria.csv` | group by `criterion`, filter `met = false` |
| read what actually happened in a run | `scenario-runs-full.csv` | filter `run_scenario_run_id` to the run |
| one row per run | `scenario-runs-full.csv` | Data → Remove Duplicates on `run_scenario_run_id` |

---

_Generated from an export of a local project: 87 judged runs, 281 checklist rows, 1556 message rows._