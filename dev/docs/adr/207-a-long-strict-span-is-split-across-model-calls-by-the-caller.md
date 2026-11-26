# ADR-207: A long Strict span is split across PII redaction model calls by the caller

**Date:** 2026-11-25

**Status:** Accepted

> One line: a Strict span batch of **8,001 to 32,000 characters** is cut by data-privacy into
> **pieces of about 4,000** that the model answers in **parallel calls under a fleet-sized
> limit**; findings are placed back **only on pieces the model cannot have reshaped**, merged
> by widest union (the model's own name rule across pieces follows, decision 7), and the span
> is **billed once**;
> any doubt sends the **whole span to Presidio**, as today.

## Context

The Strict level sends a span batch to the LangWatch PII Redaction Model only when its texts
total 8,000 characters or less (`PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS`,
`modules/data-privacy/contract/src/data-privacy.pii-redaction-spend.ts:24`); longer spans go to
Presidio with reason `too_long`. A production test found long spans were the main reason Strict
output still held names and addresses (langwatch/tasks#1226). The cap exists because the model's
time grows with length: on Lambda at 7,168 MB, 2,000 characters take 4.4 s and 20,000 take 63 s,
over its 55 s request deadline (langwatch-saas `apps/pii-redaction-model/README.md`, Measured).

Facts the design rests on, read in code:

- The model trims each entry with Python's whitespace set and unfolds `\n`, `\t`, `\r` in any
  entry that parses as JSON (its own extended syntax, `NaN` included); its offsets are code
  points of that prepared text (saas `adapters/httpapi/presidio.go:316-378`).
- Its name rule masks every word of a found name elsewhere in the text: cased scripts by word
  (3+ letters, capitalised, a stop list), uncased scripts by substring (saas `domain/namerule.go`).
- Cloud's model Lambda has a reserved concurrency of 50 and 10 warm environments, shared by
  every worker and app pod (saas `infrastructure/modules/workloads/pii_redaction_model_lambda.tf:70,74`).
  A Kubernetes or self-hosted pod answers one request at a time (`PII_MAX_CONCURRENT_REQUESTS=1`).
- The model can split a text itself across instances, but not as configured: a Lambda as its own
  peer needs egress, request signing and a gateway (a model change, out of scope here).
- The app already guards offset placement: `redactSparingNamesAndPlaces` refuses a text with a
  backslash or a surrogate, or that trim would change (`pii-analysis.rules.ts:123-140`).

ADR-201 prices every answered batch per character; it is revised alongside this (decisions 2, 6
and 12) so a split span stays one priced fact.

## Decision

1. **The caller splits; the model is unchanged.** data-privacy plans the calls. Rejected: the
   model's own split (needs a model and infra change, and runs a span's texts in series).
2. **Three ranges.** Up to 8,000 characters: one call, exactly as today. 8,001 to 32,000: split.
   Over 32,000: Presidio, reason `too_long`. Measured, as today, on the texts after in-process
   Essential masking. The ranges hold for every Strict batch the model sees, span, log record or
   metric point: they share one route to the model today, and a long log body leaks a name as a
   long span does. Each is priced as ADR-201 prices it.
3. **Pieces.** A text over 4,000 characters is cut at whitespace into pieces of at most 4,000
   with 200 characters of overlap; a piece never starts or ends on a Python whitespace
   character. Texts of 4,000 or less are packed whole into calls of at most 4,000 characters.
4. **A whole text keeps today's handling.** For a text sent whole in a split call, the model's
   own masked text is used, as in a single call, so JSON texts and spared texts behave as today.
5. **A piece is placed by offsets only when the model cannot have reshaped it.** The piece has
   no backslash, is unchanged by the model's Python strip, and its surrogate pairs are converted
   from code points with `codepointToCodeUnitConverter`. A second guard rebuilds the piece's
   masked text from the findings and requires it to equal the model's own masked piece. A piece
   that fails either sends the **whole span** to Presidio. Rejected: copying the model's JSON and
   trim rules into the app (drifts with the model); a self-check alone (a constructed case passes
   it and leaks IBAN digits, judge round 2).
6. **Merge.** Per text: shift each piece's findings by its start; drop PERSON and LOCATION for a
   spared text **before** merging; merge overlapping findings into the widest range, labelled by
   the higher score (the existing `mergeOverlapping`); mask once with `formatPiiMarker`.
7. **The model's name rule, across the pieces of one text** (R2, its own PR on top). A copy of
   `namerule.go`, cased and uncased, held to it by a parity fixture taken from its own tests. Per
   text, as the model applies it to one entry: a whole text already gets the model's own rule,
   and a name found in a placed piece is masked in the other pieces of that text. Rejected: a
   new guard of 5+ letters (leaves "Ana" raw where the unsplit call masks it); across texts
   (beyond what one unsplit call does, and an unplaceable whole text gives no names to spread).
8. **Only on a Lambda target.** Splitting runs only when the model is reached as a Lambda,
   where each invocation is its own execution. On an HTTP target (Kubernetes, self-hosted) a pod
   answers one request at a time, so split calls would queue in front of short spans that are
   answered today: there the 8,000 cap stays and longer spans keep going to Presidio.
9. **Slots are taken, never waited for.** Split calls go through the existing
   `ConcurrencyLimiter` (`packages/limiter`) with 2 slots per process and no queue. A span takes
   the free slots, up to 2, at once; with none free it falls back at once with reason `busy`, as
   fast as `too_long` does today. It then runs its calls over the slots it holds and has 50 s for
   all of them (the cap one call has today); a span whose planned calls cannot fit falls back
   before the first call, and one that runs out falls back with `timeout`. A call our own abort
   rejects holds its slot until 60 s after it started (the model's 55 s deadline plus its 5 s
   stop grace). Single-call spans are not limited, as today. On Cloud, split calls go to a
   **model function of their own** (same image, its own reserve and warm pool, in langwatch-saas),
   named by a new setting `PII_REDACTION_MODEL_SPLIT_ENDPOINT` (a Lambda ARN). Unset, nothing is
   split: self-hosted, Kubernetes and any Cloud environment without it keep today's behaviour, and
   no organization can be switched on before the function exists. Short spans keep the current
   function, its reserve of 50 and its 10 warm environments, untouched. Rejected: raising the shared
   reserve and warm pool (round 3: warmer pings and long spans can still fill the shared slots, and
   warm environments are not reserved for short spans).
10. **All or nothing.** If any call of a span fails, the span falls back at once and its other
    answers are discarded; nothing is stored unmasked and no partial result is used.
11. **A breaker of its own.** A timeout or throttle on a split call opens a split-only breaker
    (same 2 min cool-down), so long spans go to Presidio while short spans keep calling the model.
    Rejected: one shared breaker (a long span's throttle would push short spans, which work today,
    off the model).
12. **One usage line per span**, with a new `calls` count; fallback reasons gain `busy`.
13. **One-off, not shared.** The planner and merge live in data-privacy rules; no shared package.

## Constants

| name                                       | value                                                             | purpose                                                    |
| ------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS` | 8,000                                                             | most characters a span sends in one call (unchanged)       |
| `PII_REDACTION_MODEL_MAX_SPLIT_CHARACTERS` | 32,000                                                            | most characters a span may send split; over it, `too_long` |
| `PII_REDACTION_MODEL_PIECE_CHARACTERS`     | 4,000                                                             | most characters in one split call                          |
| `PII_REDACTION_MODEL_PIECE_OVERLAP`        | 200                                                               | characters a piece repeats from the previous one           |
| split calls per process                    | 2, no queue; Lambda target only                                   | in flight at once, per process                             |
| `PII_REDACTION_MODEL_SPAN_BUDGET_MS`       | 50,000                                                            | all of a split span's calls, queueing included             |
| aborted call slot hold                     | 60,000 ms from start                                              | the model's 55 s deadline + 5 s stop grace                 |
| `PII_REDACTION_MODEL_SPLIT_ENDPOINT`       | unset by default                                                  | the split function's Lambda ARN; unset = no splitting      |
| split function capacity                    | reserve and warm pool sized in the saas PR from 25 pods x 2 calls | its own; the shared function's 50 and 10 stay              |

## Invariants

| invariant                         | meaning                                                                                     | how, and its test                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| never raw                         | no text is stored with a finding the model reported left unmasked                           | all-or-nothing fallback; seam fixture asserts zero unmasked tokens                   |
| offsets index the raw piece       | a mask lands on the characters the model found                                              | decision 5 guard; fixtures: JSON lines, `NaN` JSON, U+0085 edge, emoji before a name |
| no worse than today               | a span under 8,000 and a span that falls back get exactly today's result                    | single-call path untouched; existing tests stay green                                |
| wait no longer than today         | a span reaches Presidio within 50 s, as one call does now, and at once when no slot is free | span budget, no queue; fake-clock unit test                                          |
| HTTP targets unchanged            | self-hosted and Kubernetes keep today's 8,000 cap                                           | target check; unit test on an HTTP target                                            |
| billed once                       | one spend record per span, its characters counted once, overlap never                       | ADR-201 rev; 20,000-char span bills 20,000                                           |
| short spans unharmed by long ones | a split call's throttle never opens the single-call breaker                                 | split-only breaker; unit test                                                        |
| matches the unsplit call          | names propagate as the model's own rule does (decision 7's PR, not yet built)               | parity fixture from `namerule.go` tests                                              |

## Assumptions

| assumption                                                                             | what breaks if false                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| a 4,000-character call takes about 9 to 10 s warm (interpolated from 2,000 and 20,000) | fewer pieces fit the 50 s budget; more spans fall back as `busy`/`timeout` (R3 measures it)                                     |
| at most 25 pods call the model at once on Cloud                                        | the reserve of 100 is shared thinner; throttles rise (R3's load test)                                                           |
| long texts with backslashes (escaped JSON) are a minority of long spans                | most long spans keep falling back (R3 counts it on real-shaped traces)                                                          |
| the model's prep and name rule stay as read on 2026-11-25                              | the guard keeps offsets safe (it falls back), but parity of the name rule drifts; the parity fixture catches it on the next run |

## Gates

| path                                             | reversible?                            | blast radius                           | gate                                                                                                                               |
| ------------------------------------------------ | -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| masking of split spans (decisions 3-7, 10)       | no: a missed mask stores customer text | large                                  | human review of the PR, plus the seam fixture and the guard fixtures in CI; ships behind the existing model flag, so one org first |
| billing of split spans (ADR-201 rev)             | no: money                              | large                                  | human review; unit test of the fact; the Cloud price ADR stays as is                                                               |
| concurrency, budget, breaker (8, 9, 11)          | yes                                    | large (every Strict org on a pod)      | automated: unit tests with a fake clock; R3 load test on the dev Lambda before the flag widens                                     |
| split function in langwatch-saas                 | yes                                    | small (a cost line)                    | saas infra PR, plan reviewed; the app splits only once its ARN is set                                                              |
| new setting `PII_REDACTION_MODEL_SPLIT_ENDPOINT` | yes                                    | small (a config key operators may set) | documented in the data-privacy README; unset is today's behaviour; Cloud docs with R6                                              |
| docs, picker note                                | yes                                    | small                                  | none beyond the PR                                                                                                                 |

## Rejected alternatives

- Raise the 8,000 cap without splitting: the model passes its deadline near 15,000 to 20,000.
- The model's own split: a model and infra change; texts run in series.
- Copy the model's JSON and trim rules: drifts; a guard that falls back is safer.
- Self-check alone (decision 5): a constructed case passes and leaks.
- Abort sibling calls early to save cost: an aborted Lambda keeps running; the slot would lie.
- One shared breaker; 8 calls per process (sums to 104 to 200 against a reserve of 50).

## Consequences

- Positive: long spans up to 32,000 characters get the model; short spans are untouched.
- Negative: spans of 8,001 to 32,000 characters that fell back for free are now **priced** at the
  same rate per character (customers on Strict pay for them, and the docs say so); long texts with
  backslashes still fall back; self-hosted and Kubernetes targets gain nothing yet (8,000 cap kept); more Lambda invocations and request
  fees per long span, plus a second function's warm environments (a cost the saas PR
  states from its own pricing; not measured here); one more setting for operators.
- Neutral: one more fallback reason (`busy`), one more usage field (`calls`).

## Open questions

- An invocation our 50 s abort rejects can run past the 60 s slot hold (body read before the
  model's deadline starts, cold starts over 60 s), so the limiter can overcommit and our cost
  estimate undercounts. Today's single calls share the cost gap. Follow-up row R4; owner: agent.
- A split span with a failed call records nothing (decision 2), so the completed calls' cost is
  missing from the margin report; today's failed single calls share this. Same follow-up R4.
- Split on HTTP targets: needs per-pod slots the app can see, or the model's own split. Later.
- The 4,000 and 32,000 numbers come from the issue, not a measurement; R3's benchmark confirms or
  moves them before the flag widens.

## Revisions

- v1, 2026-11-25: drafted from the map of tasks#1226 after a three-round challenge (refuters on
  Opus and Sonnet, judge gpt-6.2-astra). Round 1 added the fleet budget, the split-only breaker,
  the span budget, the missed docs and tests; round 2 moved sparing before merge and copied the
  whole name rule; round 3 replaced the self-check with the backslash and strip guard and held
  aborted calls' slots. ADR red-team round 1 (astra): split only on Lambda, no queueing, name
  rule per text, failed-span cost added to the open question. Round 2: warm pool 10 to 60 with
  the reserve. Round 3 broke that (shared slots, warmer pings, enable before infra); answer after
  the last round, not re-judged: split calls on a function of their own behind a new setting. Open after round 3: aborted-call runtime (Open questions).
- v2, 2026-11-25: accepted as drafted, split calls on a model function of their own, off until it exists in Cloud. Captain: Sergio ("do it ffs", confirming the Founder Associate's relayed yes).

## References

- ADR-201 (revised alongside), langwatch/tasks#1226, `modules/data-privacy/specs/span-pii-redaction.feature`,
  `modules/data-privacy/specs/pii-redaction-billing.feature`.
