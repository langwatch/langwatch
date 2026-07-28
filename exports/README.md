# Real exports — scenario run CSV (PR #6273)

Produced by the endpoint in this PR against a local project with 229 scenario
runs. Nothing here is hand-written or trimmed except the files under `samples/`.

**Start with [WORKED-EXAMPLE.md](WORKED-EXAMPLE.md)** — it walks one real run
from conversation to checklist to the ranked fix-list, using these files.

| File | Rows | Cols | One row is |
|---|---:|---:|---|
| `scenario-runs-full.csv` | 1556 | 28 | a conversation message |
| `scenario-runs-criteria.csv` | 281 | 23 | a run × judged checklist item |

`samples/` holds the first 25 rows of each, small enough that GitHub renders
them as a sortable table in the blob view instead of offering a download.

Notes on reading these:

- **Full covers all 229 runs. Criteria covers 87.** Not a gap in the export —
  136 runs errored before the judge ever scored a checklist, so they have no
  checklist to expand. Of runs that actually completed, 85 of 88 are judged.
- **Want one row per run?** Open the full file and de-duplicate on
  `run_scenario_run_id`. There is no separate per-run export; every run field
  is already denormalized onto every message row.
- Columns are ordered readable-first: the outcome leads, identifiers trail.
- Served gzipped (9.2x on full), so the download is far smaller than the file
  size here suggests.

Verified: 0 malformed rows in both — every row carries exactly the header's
column count, including across the 100-row streaming batch boundaries.
