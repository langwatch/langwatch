# ADR-193: PII detection Levels 0 and 1 run as their own service

**Date:** 2026-11-02

**Status:** Proposed

## Context

Strict PII redaction today asks the langevals Presidio evaluator which spans
of a trace are PII (ADR-191). Presidio finds names with spaCy, which reads
capitalisation as evidence, and ADR-191 adds a second pass for names written
in capitals. Lowercase names remain a known miss (ADR-191, Consequences),
and every miss is permanent because stored spans are not re-redacted.

A separate benchmark compared detectors for this job on public and synthetic
sets and selected two levels:

- **Level 0**: regular expressions plus checksum validators (Luhn, IBAN mod 97,
  national ID check digits, base58check). No models, no names. Each detector
  was kept only if its precision on the dev split was at least 0.6.
- **Level 1**: Level 0, plus GLiNER multi-PII (Apache-2.0) over 33 label
  prompts, plus PII-Tracer (MIT) person names above a score threshold chosen
  on the dev split, plus a name rule over all of them: a name found once is
  masked everywhere else in the same text, and "Last, First" is masked whole.

Level 1 needs about 3.6 GB of memory for GLiNER and 4.7 GB for Tracer, torch
and onnxruntime, and model weights baked into an image. It ran on AWS Lambda
in the benchmark, as two functions in parallel (one per model).

The decision here is where that code lives and how it runs, before any
decision to put it on the redaction path.

## Decision

We will add the detector as its own service, `services/piidetector`, with
its own Python project and its own uv lock, outside the root uv workspace and
outside `services/langevals`. It is not wired into the product.

1. One request contract for both entrypoints: texts plus a level (0 or 1) in,
   spans `{start, end, label, score, source}` out. A Lambda handler and a
   standard-library HTTP server both serve it.
2. One image definition with two targets (`http`, `lambda`), for amd64 and
   arm64. The models are downloaded and GLiNER is exported to ONNX at build
   time, pinned by revision; at run time the image is offline.
3. The split layout is part of the contract: a request may name components
   instead of a level, and returns their raw spans; the caller merges them
   with the same combiner (a union plus the name rule, no model). One image
   serves as either half through `PII_COMPONENTS`.
4. Level 0, the name rule and the combiner keep the benchmark's code and
   behaviour; the tests run them for real on synthetic text and replace the
   models with fakes.

## Rationale / Trade-offs

**Not inside langevals.** The langevals image is a dependency zoo already
(ADR-145); adding torch, the Tracer model code and about 8 GB of model memory
to the image every evaluator runs from (it installs all extras) would raise
the size and memory of every evaluator deployment. Presidio and this detector also answer different
questions: Presidio is a configurable evaluator with per-entity settings;
this is a fixed pipeline whose thresholds were frozen by a benchmark.

**Not in the root uv workspace.** ADR-145 puts members that share one
resolution in one lock. This project pins torch, transformers and
onnxruntime to the exact versions the benchmark measured, and torch comes
from the CPU-only PyTorch index. Joining the workspace would let an SDK
upgrade move a pin that changes spans, or a model pin hold the SDK back. The
project keeps the root's age gate (`exclude-newer = "7 days"`) in its own
`[tool.uv]` block.

**Two models instead of one.** GLiNER covers the whole label set but often
labels a name as USERNAME, which strict name redaction does not count; Level 1
takes only person names from Tracer. In the benchmark either model alone
caught fewer names as PERSON_NAME than the union with the name rule.

**Split layout.** Each function holds one model, so it needs about half the
memory, and latency becomes the slower model instead of the sum. The price is
a caller that sends two requests and merges; the merge is small, pure Python
and shipped in the service.

Accepted costs: a second Python project to keep patched, a large image (a few
GB of weights), and a cold start of about ten seconds per new container.

## Consequences

- The detector can be built, run and reviewed without touching the live
  redaction path. Putting it on that path is a later decision with its own
  ADR (which caller, which level per project, what happens on timeout).
- Security pins in the root `[tool.uv]` block do not reach this lock. Its
  dependencies are few and pinned; they need their own review on bumps.
- Changing a model pin, a threshold or a window size changes spans. The
  pins say so where they are declared; a bump needs a span comparison against
  the previous image on a synthetic sample.
- The feature-parity checker scans `services/piidetector` for Python test
  bindings, as it does for `services/langevals` and `sdks/python`.

## References

- Spec: `specs/pii-detector/pii-detector-levels.feature`
- Code: `services/piidetector/`
- Related ADRs: [ADR-145](./145-python-uv-workspace.md) (Python uv workspace),
  [ADR-191](./191-capitalised-names-get-a-second-person-pass.md) (Presidio path)
- Models: [urchade/gliner_multi_pii-v1](https://huggingface.co/urchade/gliner_multi_pii-v1),
  [perplexity-ai/PII-Tracer](https://huggingface.co/perplexity-ai/PII-Tracer)
