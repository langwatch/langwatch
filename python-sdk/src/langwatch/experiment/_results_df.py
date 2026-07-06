"""Build a per-row results DataFrame from the evaluations-v3 ``/results`` response.

Both the SDK-driven ``Experiment`` and the server-side ``run()`` helpers (platform
experiments and studio workflows) fetch the same ``{dataset, evaluations}`` payload
and turn it into the same per-row DataFrame. Keeping the builder in one place means
every entry point returns an identical column shape.
"""

from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd


def build_results_df(data: Dict[str, Any]) -> "pd.DataFrame":
    """Build a DataFrame from the platform API response (ExperimentRunWithItems)."""
    # Imported lazily so importing langwatch.experiment / langwatch.workflow does
    # not require pandas; it is only needed when reading per-row results back.
    import pandas as pd

    dataset_entries = data.get("dataset", [])
    evaluations = data.get("evaluations", [])

    if not dataset_entries:
        return pd.DataFrame()

    # Build base rows from dataset entries
    rows: List[Dict[str, Any]] = []
    for entry in dataset_entries:
        row: Dict[str, Any] = {"index": entry.get("index", 0)}
        # Flatten entry data
        entry_data = entry.get("entry", {})
        if isinstance(entry_data, dict):
            for k, v in entry_data.items():
                row[k] = v
        # Output from the target
        predicted = entry.get("predicted")
        if predicted is not None:
            row["output"] = (
                predicted.get("output", predicted)
                if isinstance(predicted, dict)
                else predicted
            )
        row["trace_id"] = entry.get("traceId", "")
        row["duration_ms"] = entry.get("duration", 0)
        cost = entry.get("cost")
        if cost is not None:
            row["cost"] = cost
        error = entry.get("error")
        if error:
            row["error"] = error
        target_id = entry.get("targetId")
        if target_id:
            row["target"] = target_id
        rows.append(row)

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    # Pivot evaluation scores into columns
    for ev in evaluations:
        idx = ev.get("index")
        name = ev.get("name") or ev.get("evaluator", "")
        if idx is None or not name:
            continue
        mask = df["index"] == idx
        target_id = ev.get("targetId")
        if target_id and "target" in df.columns:
            mask = mask & (df["target"] == target_id)
        score = ev.get("score")
        if score is not None:
            df.loc[mask, name] = score
        passed = ev.get("passed")
        if passed is not None:
            df.loc[mask, f"{name}_passed"] = passed

    # Set up proper indexing
    if "target" in df.columns and len(df["target"].unique()) > 1:
        # Multi-target: use (target, index) MultiIndex for natural grouping
        if "index" in df.columns:
            df = df.set_index(["target", "index"]).sort_index()
    elif "index" in df.columns:
        df = df.set_index("index")

    return df
