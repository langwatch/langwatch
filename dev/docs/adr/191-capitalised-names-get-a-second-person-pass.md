# ADR-191: A name written in capitals gets a second person pass

**Date:** 2026-10-31

**Status:** Proposed

## Context

Strict PII redaction asks the analysis service (the langevals Presidio
evaluator) which spans of a trace are a person's name, and stores the trace
with those spans replaced. A name it does not report is stored and shown in
full. Stored spans are not re-redacted later, so every miss is permanent.

The service finds names with spaCy's `en_core_web_lg`, which reads
capitalisation as evidence. A provider-free harness (48 synthetic names in
JSON payloads of the length production leaked) measured recall by casing:
97.9% for an ordinary name, 81.2% with the surname in capitals, and far less
with the whole name in capitals. Capitals are routine in traces: forms,
legacy columns, logistics and banking payloads. The miss is no span at all,
not a low score, so no threshold can recover it.

## Decision

We will analyse content a second time for person names only, over a copy in
which every whole word of two or more capitals is titlecased, and fold the
person spans that copy reveals into the first pass's findings.

1. The copy is built character for character and never changes length, so
   its offsets index the original. A capital whose lowercase is longer than
   itself (U+0130) is left alone.
2. A span only the copy finds is kept only if it has the shape of a name: two
   or more words, and either a rewritten word of four or more letters or two
   rewritten words side by side. A short capitalised word on its own (CFO,
   ROI) is the acronym shape and is refused.
3. The second pass is skipped when person detection is off or when the text
   holds no such shape, so prose with OK, ID or USD costs one pass.
4. Only PERSON spans come out of the second pass. Where two person spans
   overlap by cover, the wider survives, so a name is counted and redacted
   once, whole.

## Rationale / Trade-offs

Titlecasing restores the name cue on WHITFIELD and invents the same cue on
ERP. The shape rule is what prices that: a 46-string corpus of capitalised
non-names (merchants, carriers, departments, SKUs, codes, headings, acronym
prose, particle-shaped places) keeps three known false positives, one of
which predates the second pass. The other two, a product line named after
its founder and SEPA ACH in a list of payment rails, are the price of the
side-by-side clause. That clause lifted wholly capitalised names with a
short word (AMY LEE) from 5 of 24 to 24 of 24 and particle surnames (VAN DER
BERG) from 2 of 24 to 21 of 24, the control's own ceiling. Without it,
whether a name is protected would depend on how long it is.

Alternatives rejected:

- **Lowering the score threshold.** The miss is no span, not a low score.
- **Titlecasing everything before the only pass.** Every recogniser would see
  the copy, and the code, currency and identifier recognisers depend on
  capitals. A person-only second pass leaves them untouched.
- **A different model (a transformer NER or a hosted DLP).** Cost and latency
  on a service that already throttles, and a detector comparison is its own
  question (langwatch/tasks#898).
- **Requiring two long rewritten words.** It looks safer and throws an
  ordinary forename beside a capitalised surname back to where it started.

A second spaCy pass costs CPU on the texts that carry a name-shaped capital
run. The skip rule bounds that to those texts.

## Consequences

- Traces stored from now on under strict redaction have capitalised names
  redacted. Traces already stored keep whatever the old detector missed; this
  decision does not and cannot re-redact them.
- The shape rule is irreversible in one direction: a false positive redacts a
  non-name for good, a false negative stores a name for good. The precision
  corpus is the record of which false positives were accepted; a new one
  fails the build and means the rule is wrong, not the corpus.
- Lowercase names are a separate defect (no cue to restore) and are pinned at
  their measured floor only (langwatch/tasks#1055). Particle surnames remain
  bounded by the stock recogniser truncating them (langwatch/tasks#1057).

## References

- Spec: `specs/evaluators/langevals-presidio-allcaps-person-names.feature`
- End-to-end scenario: `specs/data-privacy/pii-redaction.feature`
- Code: `services/langevals/evaluators/presidio/langevals_presidio/pii_detection.py`
- Issues: langwatch/tasks#1049, #1055, #1057, #898
