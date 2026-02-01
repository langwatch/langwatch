# Analytics Parity Check

Verifies that Elasticsearch and ClickHouse analytics backends return equivalent results for the same trace data.

## Overview

This script sends identical trace data to two LangWatch projects (one configured with ES backend, one with CH backend), then queries both and compares the analytics results with a 5% numeric tolerance.

## Prerequisites

1. **Two test projects** must be created beforehand:
   - **ES project**: `featureClickHouseDataSourceTraces = false`
   - **CH project**: `featureClickHouseDataSourceTraces = true`

2. **Both backends running**: ClickHouse and Elasticsearch must be available

3. **API keys**: Each project needs an API key for the collector and analytics APIs

## Setup

```bash
cd packages/analytics-parity-check
pnpm install
cp .env.example .env
# Edit .env with your project IDs and API keys
```

## Configuration

Edit `.env`:

```env
# LangWatch API URL
BASE_URL=http://localhost:3000

# Elasticsearch project (featureClickHouseDataSourceTraces = false)
ES_PROJECT_ID=proj_xxx
ES_API_KEY=lw_xxx

# ClickHouse project (featureClickHouseDataSourceTraces = true)
CH_PROJECT_ID=proj_yyy
CH_API_KEY=lw_yyy

# Optional settings
TOLERANCE=0.05        # 5% numeric tolerance
TRACE_COUNT=20        # traces per variation
WAIT_TIME_MS=10000    # ingestion wait time
```

## Usage

```bash
pnpm start
```

## Test Data Variations

The script generates traces covering:

1. **LLM spans** - Different models (GPT-4, Claude, etc.), token counts, costs
2. **RAG spans** - With document contexts for top documents testing
3. **Chain/Tool spans** - Nested parent-child relationships
4. **Metadata variations** - user_id, thread_id, labels, custom keys
5. **Error traces** - With error flags set
6. **Evaluations** - Pass/fail, scores, labels

## Verification Queries

| Query | Description |
|-------|-------------|
| `timeseries_trace_count` | Trace count over time |
| `timeseries_cost_sum` | Total cost aggregation |
| `timeseries_token_counts` | Prompt/completion tokens |
| `timeseries_avg_completion_time` | Average completion time |
| `filter_user_ids` | Unique user IDs |
| `filter_thread_ids` | Unique thread IDs |
| `filter_labels` | Label distribution |
| `filter_models` | Model usage |
| `filter_span_types` | Span type distribution |
| `top_documents` | RAG document rankings |
| `feedbacks` | Feedback events |

## Output

- **Console report** with pass/fail status for each query
- **JSON report file** (`parity-report-<run-id>.json`) with full details
- **Exit code**: `0` if all queries pass, `1` if any fail

### Example Output

```text
========================================
ANALYTICS PARITY CHECK RESULTS
========================================

Total Queries: 11
Passed: 10
Failed: 1
Overall: FAILED

------------------------------------------------------------
QUERY DETAILS
------------------------------------------------------------

[PASS] timeseries_trace_count
[PASS] timeseries_cost_sum
[FAIL] filter_models
  Discrepancies:
    - options[gpt-4].count: ES=45 vs CH=42 (6.7% diff)
```

## Data Persistence

Data persists after script runs for manual inspection in the LangWatch UI.
