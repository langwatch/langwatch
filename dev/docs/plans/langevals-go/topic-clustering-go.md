# Topic clustering in Go

Status: design, 2026-09-30. Companion to `dev/docs/plans/langevals-go-replacement.md` (§3.1 layout,
§5.4 caps, §8.6 clustering, §11 phase 5, decision D6). Everything below was read from the Python
source (`services/langevals/evaluators/topic_clustering/langevals_topic_clustering/`, 1,428 lines),
the scipy 1.17.1 / numpy 1.26.4 sources pinned in `services/langevals/uv.lock`, and the TS callers;
the parity numbers come from a throwaway Go prototype run against scipy on the same data (§4).

## 1. Summary

- The numerics are small and exactly portable. Ward linkage (scipy's nearest-neighbour chain),
  `fcluster` by distance, centroids, p95 and cosine assignment were re-implemented in ~290 lines of
  Go and matched scipy on 9 datasets (n = 200 to 5,000, dim 1,536, up to 90% duplicate vectors):
  identical merge order and cluster ids in every row of Z, identical flat labels at both
  thresholds, merge heights within 1.1e-14, p95 within 3.3e-16, centroids bit-identical.
- The TS side never sends more than **2,000 traces** per call (the ClickHouse page CTE's
  `LIMIT 2000`, inputs cut to 8,192 characters), so the distance matrix is 16 MB, not the 400 MB
  the plan budgets for 10k. Go computes one page's numerics in ~0.2 s on 10 cores (1.3 s on one);
  scipy takes 1.0 to 1.3 s.
- The wall clock and the risk both sit in the LLM calls: up to 100 sequential embedding batches,
  one naming call per ~150 samples, up to 3 disambiguation rounds per naming task, tenacity waits
  of 12 s. Naming prompts are **random by construction** (unseeded shuffles and hash-ordered sets),
  so naming cannot be replayed byte for byte; parity is cluster membership plus the call plan.
- Three defects in the Python incremental path need a ruling before porting (§9, Q1 to Q3); the
  worst assigns traces to a topic id that is never created.
- Budget: ~1,250 lines of Go production code, ~1,100 lines of tests and fixtures.

## 2. The algorithm today, end to end

### 2.1 Wire

`POST /topics/batch_clustering`, `POST /topics/incremental_clustering`, JSON, one response shape.

| Field | Batch | Incremental | Notes |
|---|---|---|---|
| `project_id` | yes | yes | log context only |
| `traces[]` | yes | yes | `{trace_id, input, topic_id, subtopic_id}`; at most 2,000; input at most 8,192 chars |
| `topics[]` | | yes | `{id, name, centroid[1536], p95_distance}` |
| `subtopics[]` | | yes | as topics plus `parent_id` |
| `litellm_params` | yes | yes | chat model and credentials, strings |
| `embeddings_litellm_params` | yes | yes | embedding model, credentials, `dimensions: 1536` (always, from TS) |
| `deployment_name` | optional | optional | never sent by TS; the Azure rewrite it drives is also never used (the rewritten `model` is not read by naming). Drop. |

Response: `{topics[], subtopics[], traces[{trace_id, topic_id|null, subtopic_id|null}], cost{amount, currency:"USD"}}`.
Any exception becomes HTTP 500 `"Batch clustering failed"` / `"Incremental clustering failed"`;
TS turns every non-2xx into `ClusteringError(CLUSTERING_SERVICE)` and the outbox retries (3
attempts, 20-minute lease, request deadline 12 minutes = 60% of the lease).

TS picks the mode: incremental when the project has topics and at least 1,200 assigned traces,
else batch; batch needs 10 usable traces on the page, incremental 1. Incremental pages hold only
traces not yet assigned to a current topic.

### 2.2 Embeddings (`utils.fill_embeddings`)

1. Drop traces whose input is empty or whitespace only (they are neither embedded nor returned).
2. `dimensions` is removed from the params (a litellm workaround); the provider returns its native
   size and each vector is **zero-padded or truncated to 1,536**.
3. Batches of 20 texts, **sequential**, one `litellm.embedding(input=[...])` call each; an empty
   text would be sent as `"<empty>"`.
4. On any batch error: an authentication error re-raises at once; any other error **abandons all
   batches so far** and restarts over every text on the per-text path: chunks of 20, 8 threads,
   one call per text. A failed text yields `None` (the trace is dropped); the **third** failure
   re-raises; all failing re-raises the last error.
5. No tenacity retry on embeddings. The OpenAI SDK under litellm retries twice on 429/5xx by
   default; the Go gateway's own retry policy replaces that.
6. The process-wide `patch_litellm()` (imported via `langevals_core.base_evaluator`) sets
   `drop_params`, maps request env credentials, applies `X_LITELLM_EMBEDDINGS_*` and an operator
   `AZURE_EMBEDDINGS_DEPLOYMENT_NAME` override. Embedding cost is **never** counted.

### 2.3 Batch (`batch_clustering`)

`build_hierarchy(traces, t=4, max_p95=1, with_subtopics=True)`:

1. `Z = linkage(embeddings, "ward")`: `pdist` (Euclidean) then `nn_chain` (§3).
2. `labels = fcluster(Z, t, criterion="distance")`.
3. For each label in ascending order (`set()` of small ints iterates ascending; verified):
   - skip if the cluster has fewer than **5 distinct inputs** (`MINIMUM_TRACES_PER_TOPIC`);
   - compute centroid and p95 (§2.5); skip if `p95 > max_p95`;
   - topic level: recurse on the cluster with `t=2`, same `max_p95`, `with_subtopics=False`; skip
     the topic if the recursion returns fewer than **1** subtopic; key `"Topic <label>"`;
   - subtopic level: key `"Subtopic <label>"` → the member traces.
4. Traces that fall into a dropped topic or subtopic are **not returned at all**.

Then naming (§2.6), then `build_response`:

- Topics in hierarchy order. A topic survives if it has at least 1 subtopic, at least 5 distinct
  inputs across its subtopics and a non-null name: id `topic_<nanoid(21)>`, centroid and p95
  recomputed over the union of its subtopics' traces (not the whole flat cluster).
- A subtopic survives if its topic did, it has at least 5 distinct inputs and a non-null name: id
  `subtopic_<nanoid>`, its own centroid and p95.
- Every trace in the hierarchy is emitted with `topic_id` / `subtopic_id` set or null.

### 2.4 Incremental (`incremental_clustering`)

1. Embed as §2.2.
2. **Assign** (`assign_trace_to_topic`): if the trace has no topic, cosine distance to every topic
   centroid; take the minimum (stable sort, so the first topic wins a tie) and accept it if
   `d <= p95 * 1.1`. If it now has a topic and no subtopic, the same against that topic's
   subtopics. Traces with a topic are emitted `{trace_id, topic_id, subtopic_id|null}`.
3. **New topics**: collect traces still without a topic. If **more than 100**
   (`MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_TOPIC`): `build_hierarchy(t=4, max_p95 = mean of the
   existing topics' p95, with_subtopics=True)`, name with `existing = existing topic names`,
   `build_response`. If 100 or fewer, the unassigned traces are emitted **as they are**, with
   null ids (defect 2, §9).
4. **New subtopics**: group traces that matched an existing topic but no subtopic. For each topic
   with **at least 50** (`MINIMUM_UNASSIGNED_TRACES_TO_CREATE_NEW_SUBTOPIC`):
   `build_hierarchy(t=2, max_p95 = mean p95 of that topic's existing subtopics, with_subtopics=False)`;
   the mean of an empty list is NaN and `p95 > NaN` is false, so no p95 filter applies then. The
   result is wrapped as `{"New Sub Topics": hierarchy}`, topic naming is skipped (the "name" is the
   literal key), subtopics are named with `existing = that topic's subtopic names`, `build_response`
   runs, the throwaway topic is discarded and the subtopics are re-parented to the real topic. The
   traces keep the **throwaway topic id** (defect 1, §9) and also still appear from step 2 (defect 3).
5. Response: new topics, new subtopics, step-2 traces followed by steps 3 and 4 traces, summed cost.

### 2.5 Centroid, p95, cosine

- `centroid = np.mean(vectors, axis=0)`: an axis-0 reduction of a C-ordered array is a plain
  sequential sum per dimension (not pairwise), then one division by n.
- `cdist(u, v, "cosine")`: row norms `sqrt(Σx²)` summed sequentially, `dot` summed sequentially,
  `c = dot / (|u|·|v|)`, clipped to ±1 when `|c| > 1`, `d = 1 - c`. A zero vector gives NaN.
- `np.percentile(d, 95)`, method `linear`: virtual index `(n-1)·0.95`, `g = vi - floor(vi)`,
  numpy's `_lerp`: `a + (b-a)·g` when `g < 0.5`, else `b - (b-a)·(1-g)`. Any NaN in the input
  makes the result NaN (Go's `sort.Float64s` would not; check explicitly).

### 2.6 Naming (`topic_naming`)

`generate_topic_and_subtopic_names` runs in a thread pool (default size `min(32, cpus+4)`), all
tasks concurrent:

- **One topic task** (skipped in the new-subtopics path): per topic, for each subtopic take 5
  random distinct inputs (each cut to 140 characters), flatten, shuffle, keep 30.
- **One subtopic task per topic**: per subtopic, 20 random distinct inputs cut to 140 characters.

Each task is `generate_topic_names_split_and_improve_similar_names` (tenacity: 2 attempts, 12 s):

1. **Split**: `split = min(ceil(total / max(1, ceil(total/150))), 150)` samples; topics are added to
   a batch until its sample count reaches `split`, then one call per batch, remainder last.
2. **Name call** `generate_topic_names` (tenacity: 4 attempts, waits clamp to 12 s each, so
   12 + 12 + 12 s): system prompt P1 (+ P2 when `existing` is non-empty), user message
   `"# Topic {i} Samples\n\n" + samples joined by "\n"`, topics joined by `"\n\n\n"`;
   `temperature=0`; one tool `topicNames` with string properties `topic_0..topic_{k-1}`, forced via
   `tool_choice`. A missing or empty `topic_i` raises (and is retried). After the retries the batch
   is swallowed: `None` for each of its topics.
3. **Disambiguate** `improve_similar_names`, at most 3 rounds: embed all names (`None` → `""` →
   `"<empty>"`), find the closest pair of non-empty names by cosine distance (strict `<`, scanning
   i then j), stop if the distance is over **0.6**, else one call with P3, user message
   `"# Topic A: {a}\n\n{a samples}\n\n# Topic B: {b}\n\n{b samples}"`, tool `topicNames` with
   `topic_a`, `topic_b`, and replace both names. Any error here fails the task attempt, and the
   outer retry redoes the whole task, naming included; the failed attempt's cost is lost. If the
   second attempt fails too, the endpoint answers 500.
4. **Cost**: `completion_cost(response)` per naming and disambiguation call, summed; USD. The
   process-wide patch makes an unpriced model return `None`, and `cost += None` then raises inside
   the split's `try`, so **an unpriced chat model yields no names and therefore no topics**.
5. Calls go through `patch_litellm()`'s completion wrapper: forced-tool refusal fallback to auto
   with a reminder, the reasoning-tool conflict, GPT-5 temperature, Anthropic sampling,
   `drop_params`; a module import also sets `AZURE_API_VERSION=2024-02-01` process-wide.

The prompts, rendered from the source (each backslash line continuation keeps the next line's
indentation, so the runs of spaces are part of the prompt):

- **P1** (system): `You are a highly knowledgeable assistant tasked with taxonomy for naming topics`
  + 17 spaces + `based on a list of examples. Provide a single, descriptive name for each topic.`
  + 17 spaces + `Avoid using "and" or "&" in the name, try to summarize it with a single concept.`
  + 17 spaces + `Topic names should not be similar to each other, as the data is already organized,`
  + 17 spaces + `the disambiguation between two similar topics should be clear from the name alone.`
  + 20 spaces + `{P2 or ""}`.
- **P2**: `\n\nThose are the topics that already exist, avoid using any names that may overlap`
  + 9 spaces + `in meaning with them, think how the current sample data is unique and different from those instead:\n\n`
  + 12 spaces + existing names joined by `"\n"`.
- **P3** (system): `You are a highly knowledgeable assistant tasked with taxonomy for naming topics,`
  + 21 spaces + `right now we have two topics with very similar names, and we need to disambiguate between them,`
  + 21 spaces + `to have a better name that really contrasts what one topic is about versus the other.`
  + 21 spaces + `Please look at the topics A and B and come up with a new, concise but constrasting name for each,`
  + 21 spaces + `based on their examples.`
- **Tool description** (both tools): `use this function to name the topics based on the examples provided, avoid using "and" or "&" in the name, try to name it with a single 2-3 words concept.`

The Go port generates these three templates from the Python source once (an `ast` render, as done
for this document) into `rules/prompts/*.tmpl` and asserts them byte for byte.

**Call counts** for a batch page with T topics and S subtopics in all: naming calls
`ceil(30T / 150)` for topics plus, per topic, `ceil(20·s_i / 150)`; disambiguation at most
3 × (T + 1) calls; name-embedding calls at most 3 × (T + 1) (both double if a task retries). With T = 20, S = 60: about 30 naming,
up to 63 disambiguation, up to 63 name-embedding calls, plus 100 trace-embedding batches.

## 3. The numerics Go must reproduce

| Python call | What Go reproduces |
|---|---|
| `pdist(X, "euclidean")` | For each pair i<j in row-major condensed order: `s += (a-b)²` in index order, `sqrt(s)`. scipy's C++ loop unrolls across 4 pairs, never within a pair, so the per-pair order is sequential. |
| `linkage(y, "ward")` → `_hierarchy.nn_chain` | Chain starts at the lowest live index; the previous chain element is the initial minimum (ties keep it, which stops cycles); scan i = 0..n-1 with strict `<`; merge when the nearest neighbour is the previous element; order the pair so x < y; record `[x, y, d, nx+ny]`; the merged cluster lives in slot y, x dies; update every live i with Lance–Williams Ward on **non-squared** distances: `sqrt((ni+nx)·t·dxi² + (ni+ny)·t·dyi² − ni·t·dxy²)`, `t = 1/(nx+ny+ni)`, evaluated left to right. |
| (inside `nn_chain`) | `argsort(Z[:,2], kind="mergesort")`, a **stable** sort by height, then `label()`: a union-find over 2n−1 slots with path compression renames each row to its current roots (smaller first) and writes the merged size; new cluster ids are n, n+1, ... in sorted-row order. |
| `fcluster(Z, t, "distance")` → `cluster_dist` | `get_max_dist_for_each_cluster`: iterative post-order DFS from the root (id 2n−2), left child (`Z[:,0]`) first, MD = max of own height and children's MD. `cluster_monocrit`: the same DFS; the first node on the way down with `MD <= t` becomes a leader and opens cluster `++k`; leaves under no leader each open their own cluster. Labels are 1..k in DFS order, int32. |
| `fcluster(..., "maxclust")` | Not used by langevals; not ported. |
| `np.mean(axis=0)` | sequential sum per dimension, then divide by n |
| `cdist(..., "cosine")` | §2.5, including the ±1 clip |
| `np.percentile(q=95)` | §2.5, numpy 1.26 `linear` with the `g >= 0.5` branch, NaN in → NaN out |
| `np.dot` / `np.linalg.norm` (name de-duplication) | BLAS sums; only compared with 0.6 and for the argmin, so plain Go loops are enough |

**Validation**: `linkage` raises on non-finite distances and on fewer than 2 observations (empty
condensed matrix). Batch with fewer than 2 embedded traces is therefore a 500 today; keep it an
error (a `herr` code), not an empty answer, unless Q6 rules otherwise.

**Floating point**: Go on arm64 fuses `x*y + z` into FMA; scipy's wheels differ by platform too
(clang on macOS contracts within a statement, gcc on baseline x86-64 cannot). Write every
accumulation as `s += float64(d * d)` so Go never fuses, and accept heights to 1e-12 relative, not
bits. Membership can differ only when a merge height sits within ~1e-15 of 4 or 2, or two
candidate distances in the chain tie to the last bit; none occurred in the runs below.

**Libraries**: gonum has no hierarchical clustering (`stat` has none; `graph/community` is
modularity-based). `knightjdr/hclust` (MIT, 21 stars, last push 2023) has Ward via NN-chain but not
scipy's `label()` renumbering, stable height sort or `fcluster`, so it would need the same parity
work plus a dependency. `diffeo/kodama` is Rust behind cgo. `cipepser/goClustering` is dormant since
2018. Hand-writing wins: the prototype's linkage, label and fcluster are ~190 lines.

**float32?** No. At n ≤ 2,000 the condensed matrix is 16 MB in float64; float32 would move
heights by ~1e-7 relative and could reorder near-ties in the chain for no saving that matters.

**Memory** (float64; Python needs several times this in boxed floats, hence its measured 2.7 GB):

| n | condensed matrix n(n−1)/2 × 8 | embeddings n × 1536 × 8 |
|---|---|---|
| 1,000 | 4.0 MB | 12.3 MB |
| 2,000 (the cap) | 16.0 MB | 24.6 MB |
| 5,000 | 100 MB | 61 MB |
| 10,000 | 400 MB | 123 MB |
| 20,000 | 1.6 GB | 246 MB |

Go updates the distance matrix in place (scipy copies it), so the matrix counts once.

## 4. Parity prototype

Throwaway code (deleted after the run): `gen.py` built clustered unit vectors (12 topics × 3
subtopics, per-point noise, float32-rounded like provider output, a fraction of exact duplicates)
and ran `linkage`, `fcluster` at 4 and 2, centroid and p95 per topic, and the per-trace `cdist`
assignment loop exactly as the service does; `main.go` did the same in Go and compared.

| n | duplicates | Z rows with different ids/sizes | max \|Δheight\| | max rel Δheight | labels differing t=4 / t=2 | clusters t=4 | max \|Δp95\| | max \|Δcentroid\| |
|---|---|---|---|---|---|---|---|---|
| 200 | 5% | 0 | 1.8e-15 | 4.3e-16 | 0 / 0 | 10 | 2.2e-16 | 0 |
| 300 | 90% | 0 | 2.7e-15 | 4.7e-16 | 0 / 0 | 12 | 2.2e-16 | 0 |
| 500 | 5% | 0 | 1.8e-15 | 4.6e-16 | 0 / 0 | 12 | 3.3e-16 | 0 |
| 1,000 | 5% | 0 | 3.6e-15 | 8.4e-16 | 0 / 0 | 34 | 3.3e-16 | 0 |
| 1,500 | 5% | 0 | 1.8e-15 | 1.1e-15 | 0 / 0 | 36 | 2.2e-16 | 0 |
| 2,000 | 5% | 0 | 3.6e-15 | 1.3e-15 | 0 / 0 | 36 | 2.2e-16 | 0 |
| 2,000 | 5% | 0 | 5.3e-15 | 9.0e-16 | 0 / 0 | 36 | 2.2e-16 | 0 |
| 2,000 | 60% | 0 | 7.1e-15 | 7.3e-16 | 0 / 0 | 36 | 3.3e-16 | 0 |
| 5,000 | 5% | 0 | 1.1e-14 | 1.9e-15 | 0 / 0 | 36 | 1.9e-16 | 0 |

Label agreement is exact, not merely up to relabelling: Go reproduces scipy's cluster numbers.

Timings (Apple M-series, 10 cores; scipy is single-threaded):

| Step | scipy n=2,000 | Go n=2,000 (10 cores / 1 core) | scipy n=5,000 | Go n=5,000 (10 / 1) |
|---|---|---|---|---|
| pdist + linkage | 1.00 to 1.28 s | 0.18 to 0.35 s / 1.26 s | 8.19 s | 1.75 s / 8.6 s |
| of which linkage only | | 26 to 62 ms | | 0.27 to 0.34 s |
| fcluster | 0.6 ms | 0.08 ms | 1.3 ms | 0.2 ms |
| assignment, n traces × 36 centroids | 0.38 to 0.49 s | 0.11 to 0.17 s | 1.02 s | 0.30 to 0.37 s |

`pdist` is 95% of the cost: a goroutine per row band plus four pairs per pass sharing the load of
`a[t]` (each pair still summed in index order). The assignment loop is O(n·T·1536) and negligible.

## 5. Mapping onto the plan's channels

**`LLMChannel.Embed(ctx, tenant, EmbedRequest{Model, Params, Inputs []string})`** returns vectors in
input order plus usage. The service owns batching (20), the per-text fallback and the three-failure
rule; the channel owns one provider call. Recommend up to 4 batches in flight (Q5); outputs do not
change, only the rate-limit exposure.

**`LLMChannel.Complete`** with a forced tool: `Tools: [topicNames schema]`, `ToolChoice: topicNames`,
`Temperature: 0`. It is the same request shape as the langevals judges (plan §8.2), so the judge
loop's compatibility behaviours (refusal fallback with reminder, reasoning conflict, GPT-5
temperature, Anthropic sampling) come with it; clustering must not add its own. The service reads
`tool_calls[0].arguments` and hands the string to a pure parser in `rules/`.

**Retries** live in the service with an injected clock/sleeper so tests do not wait: naming call 4
attempts at 12 s, naming task 2 attempts at 12 s, no retry around embeddings beyond the gateway's.

**Cost**: price each `Complete`'s usage with the gateway's pricing tables (plan §6.3) and sum in
USD. Two parity calls to rule (Q3, Q4): embeddings are uncharged today; an unpriced chat model
yields no topics today.

**Staging**: not a module channel. The inbound half already exists in
`services/nlpgo/adapters/httpapi/staged_payload.go` (S3 host allow-list, 256 MiB fetch cap); move
it to `pkg/` with the safe dialer (plan §3.2, §5.3) and wrap the two clustering routes with it
before `pkg/rpc.Decode`. TS keeps `ObjectStorageLangevalsPayloadStaging`; only SaaS sets a staging
threshold.

**Ids**: `topic_` / `subtopic_` + 21-character nanoid (alphabet `A-Za-z0-9_-`), from an injected id
source so fixtures are stable. There is no nanoid in the Go tree; 10 lines over `crypto/rand`.

**Randomness**: sample selection and shuffles take an injected `*rand.Rand` (seeded from
`crypto/rand` in production, fixed in tests). Do not try to reproduce Python's Mersenne Twister or
string-set order; the Python prompts are not reproducible even run to run.

## 6. Design in the module grammar

```
services/nlpgo/modules/evaluators/
  contract/
    api.go                ClusterTopics(ctx, Tenant, TopicClusteringRequest) (TopicClusteringResult, error)
    types.go              + TopicClusteringRequest{Mode, Traces, Topics, Subtopics, ChatModel, EmbeddingsModel},
                            ClusteringTrace, ClusteringTopic, ClusteringSubtopic, TraceTopicAssignment, Cost
    errors.go             + topic_clustering_failed (500), topic_clustering_too_few_traces (422, see Q6)
  services/
    topic_clustering.go   TopicClusteringService: embed, batch/incremental flows, naming orchestration
                          (errgroup, bounded), retries, cost, ids; no arithmetic of its own
  rules/                  pure, no I/O, no clock, no randomness except an injected *rand.Rand
    ward_linkage.go       Pdist, WardLinkage (nn-chain + stable sort + label), FlatClustersByDistance
    cosine.go             CosineDistance, Centroid, Percentile95 (shared with similarity/sentiment)
    topic_hierarchy.go    BuildHierarchy: thresholds 4/2, 5 distinct inputs, p95 ceiling, recursion
    topic_assignment.go   MatchTopic (≤ 1.1 × p95), AssignTrace
    topic_increment.go    the 100 / 50 decisions and the mean-p95 ceilings (NaN rule)
    topic_response.go     BuildResponse: survival rules, centroids over the union, id stamping
    topic_naming.go       sample selection (5/30, 20, 140 chars), split batching (150), prompt and
                          tool-schema rendering, answer parsing (missing key = error), closest pair
    prompts/topic_names.tmpl, topic_names_existing.tmpl, topic_pair_names.tmpl   go:embed, byte-exact
  transport/rpc/http.go   + POST /go/evaluators/topics/batch_clustering
                          + POST /go/evaluators/topics/incremental_clustering
                            bearer auth (plan §5.1), staged-payload wrapper, Decode cap 180 MB,
                            wire JSON in the Python field names (snake_case)
```

The service sequence (batch):

1. `rules.UsableTraces` → `Embed` (service loop, fallback) → vectors normalised to 1,536.
2. `rules.BuildHierarchy(vectors, 4, 1.0)`; if empty, answer empty with zero cost.
3. Naming: one topic task plus one subtopic task per topic, concurrently (errgroup, limit ~8), each
   `split → Complete → rules.ParseNames` with retries, then up to 3 rounds of `Embed(names) →
   rules.ClosestPair → Complete(pair)`.
4. `rules.BuildResponse(hierarchy, names, ids)`; cost summed.

Incremental adds `rules.AssignTrace` per trace and the two creation steps from §2.4.

**Memory and body size.** A real page body is at most ~16 MB of ASCII input (up to ~64 MB if every
character is 4-byte UTF-8) plus ~30 KB per incremental topic centroid; 180 MB is a ceiling, not a
workload. `pkg/rpc.Decode` reads then unmarshals, so peak is about 2× body + parsed values: under
~250 MB for a realistic worst page, ~450 MB at the cap. Streaming decode (`json.Decoder.Token`
over `traces`) would save only the raw copy; skip it until a page is measured near the cap. Free the
body buffer before linkage (it is out of scope once decoded).

**Deployment (D6).** Same image, `--only topics`. Per job: ≤ 450 MB at the cap, ~1.3 CPU-seconds of
numerics, minutes of LLM I/O. TS runs at most 3 clustering pages at once, cluster-wide
(`TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE`). Recommend 2 replicas, requests 250m / 512 Mi, limits
2 CPU / 1.5 Gi, a per-pod job semaphore of 2 (waiting, not refusing: the TS deadline is 12
minutes), `GOMEMLIMIT` at 90% of the limit, a PDB of 1. The numbers would fit beside the studio
pods; D6 is decided, so this only means the Deployment can stay small.

**Deadline.** The module's clustering deadline is 11 minutes (under TS's 12); cancellation stops
provider calls through `ctx`.

**TS side.** `LangevalsClusteringService` gains the per-evaluator engine switch
(`topic_clustering: python | go | shadow`) and the nlpgo endpoint; the error mapping is unchanged
(any non-2xx is `ClusteringError`). Shadow calls Go on a sampled set of projects and logs topic
counts, assigned-trace share and membership agreement (Jaccard of matched topics); it doubles LLM
spend for those projects, so sample.

## 7. Parity fixtures

Record once from Python, commit under `services/nlpgo/modules/evaluators/rules/testdata/clustering/`
and `.../services/testdata/clustering/`:

| Fixture | Content | Asserted by |
|---|---|---|
| synthetic vectors | a SplitMix64 + Box–Muller generator written identically in Python and Go (~20 lines each), so no vectors are committed; seeds for n = 50, 500, 2,000 with 5% and 60% duplicates | Z ids and sizes exact, heights 1e-12 relative, labels at 4 and 2 exact, centroids and p95 1e-12 |
| real embeddings | ~300 synthetic but realistic prompts across ~8 themes, embedded once with text-embedding-3-small; stored as float32 (≈1.8 MB, or gzip) keyed by input text | `BuildHierarchy` membership exact (topic → subtopic → trace ids) against Python's `build_hierarchy` output |
| incremental case | the same 300 plus 150 new texts, existing topics/subtopics from a Python batch run | assignments exact; new-topic and new-subtopic membership exact; the 100/50 thresholds straddled (99/100/101, 49/50) |
| edge vectors | zero vector, a single trace, all-identical vectors, NaN p95 path | error vs value exactly as Python |
| prompts | the three rendered templates | byte-exact |
| naming plan | scripted `LLMChannel` twin answering by tool key (`topic_i`, `topic_a/b`) and scripted name embeddings | call count per split, sample limits, existing-names suffix, missing-key retry then `None`, disambiguation stops at 0.6 and after 3 rounds, cost sum |

Naming answers cannot be keyed by prompt text (the samples are random), so the memory twin keys by
the tool's property set and call order, and throws on anything unscripted. The recorder is a Python
script under `services/langevals/.../scripts/` that monkeypatches `litellm.embedding` to read the
recorded vectors; it goes with Python in phase 7, the fixtures stay.

## 8. Specs

Supersede in the same change: `specs/nlp-go/_shared/contract.md:22` and `:236` (the "stays in
Python" non-goal), `specs/nlp-go/python-removal.feature:56`, the whole of
`specs/nlp-go/topic-clustering.feature` (routing and the 3,072 MB Lambda tier), and the langevals
side of `specs/langevals-staging/staged-payload.feature` (rebind the fetch, 413 and 502 scenarios
to nlpgo). New `specs/evaluators/topic-clustering-go.feature`, each `@unimplemented` with its level:

- `@unit` Ward linkage reproduces scipy's merge order, heights and cluster ids.
- `@unit` Flat clusters at distance 4 (topics) and 2 (subtopics) match scipy's labels.
- `@unit` A cluster with fewer than 5 distinct inputs, a p95 over the ceiling, or no surviving
  subtopic is dropped and its traces are not returned.
- `@unit` Whitespace-only inputs are neither embedded nor returned.
- `@unit` Embeddings are padded or truncated to 1,536 dimensions.
- `@integration` A failed embedding batch falls back to one call per text; two failed texts drop
  those traces; a third fails the run; an authentication error fails at once.
- `@unit` A trace joins the nearest topic within 1.1 × its p95, else stays unassigned; no topics
  means unassigned.
- `@unit` More than 100 unassigned traces create new topics bounded by the mean existing p95; 100
  or fewer are returned unassigned.
- `@unit` At least 50 traces under a topic without a subtopic create subtopics under that topic
  (the parent id per Q1).
- `@unit` Names are asked in batches of at most 150 samples with the topic's samples and the
  existing names; a missing name is retried, then the topic is dropped.
- `@unit` Similar names (cosine distance ≤ 0.6) are disambiguated at most three times.
- `@unit` The cost is the sum of the naming calls, in USD (embeddings per Q3).
- `@integration` A body over the clustering cap is refused with 413; a staged body is fetched from
  its presigned URL.
- `@integration` Fewer than 2 usable traces answers the error code of Q6.
- `@integration` Clustering past its deadline stops provider calls and answers an error.

## 9. Defects and open questions

| # | Question | Decision or recommendation |
|---|---|---|
| Q1 | **Defect 1**: new subtopics from the incremental path are re-parented to the real topic, but their traces are returned with the throwaway `"New Sub Topics"` topic id, which is never created; TS then assigns those traces to a missing topic with a null name. Port or fix? | **Decided (Alex, 2026-09-30): fix in Go.** Emit the real parent topic id; a spec scenario states it; excluded from the membership comparison. |
| Q2 | **Defect 2**: with 100 or fewer unassigned traces, the raw unassigned traces are appended to `traces` with null ids (FastAPI drops the extra keys), so TS sends a null assignment for each. | **Decided: fix in Go** (with Q1): no null-id rows; confirm how `assignTopic` treats the absence. |
| Q3 | **Defect 3**: a trace matched to a topic without a subtopic appears twice when that topic gets new subtopics (once topic-only, once with the new subtopic); TS applies both in `Promise.all`. | **Decided: fix in Go** (with Q1): one row per trace, the later one winning. |
| Q4 | Embedding calls are never costed. | **Decided:** price embeddings through the gateway's pricing, behind a switch that starts off, so the cost reported stays as today until it is turned on. |
| Q5 | An unpriced chat model makes naming fail and yields no topics. | **Decided:** price at 0 and name anyway, with a warning log; the spec states the improvement. |
| Q6 | Fewer than 2 usable traces raises inside scipy (500). | Keep an error, as a named code so TS logs it plainly. |
| Q7 | Sequential embedding batches (100 calls for 2,000 traces). | **Decided:** 4 batches in flight. |
| Q8 | `AZURE_API_VERSION=2024-02-01` and `AZURE_EMBEDDINGS_DEPLOYMENT_NAME` come from process env today. | Default the Azure version in `pkg/litellmparams` when the params omit it; the deployment override arrives from TS or is dropped (the module never reads env). |
| Q9 | Should the Go API expose one `ClusterTopics` or two methods? | One, as the plan's contract lists (a mode field); no new operation. |

**Risks**

- Naming quality drift is invisible to replay; only shadow comparison shows it.
- Forced tool calls differ by provider in the Go gateway versus litellm (Anthropic, Gemini,
  Bedrock); the judge loop's phase-3 work must land first.
- FMA and summation order: guarded by `float64()` conversions and tests on amd64 and arm64.
- NaN paths (zero vectors, empty means) follow IEEE in Go except the percentile, which needs its
  explicit check.

## 10. Estimate

| File | Go lines |
|---|---|
| `rules/ward_linkage.go` | 200 |
| `rules/cosine.go` (centroid, p95, cosine) | 70 |
| `rules/topic_hierarchy.go` | 110 |
| `rules/topic_assignment.go` + `topic_increment.go` | 110 |
| `rules/topic_response.go` | 100 |
| `rules/topic_naming.go` + 3 templates | 230 |
| `services/topic_clustering.go` | 330 |
| contract types, errors, API method | 70 |
| transport routes + staging wrapper move | 60 |
| **Production** | **~1,280** |
| rules tests (linkage, fcluster, cosine, hierarchy, naming rules) | 450 |
| service tests over memory twins (batch, incremental, retries, cost, deadline) | 400 |
| fixture generator (Go + Python) and recorder | 200 |
| transport test (auth, 413, staged) | 80 |
| **Tests and fixtures** | **~1,130** |

The plan's ~1,500-line budget holds. The numerics are one day; the orchestration, naming and
fixtures are the rest of the phase.
