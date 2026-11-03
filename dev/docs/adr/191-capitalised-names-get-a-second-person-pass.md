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
3. The span must also be worded like a name. Either one word's
   ordinary-case form sits at least 1.5 times nearer the top of the model's
   frequency-sorted vocabulary than its lowercase and capital forms (roughly
   1.5 times as frequent, since frequency falls as one over rank), or every
   word is on a bundled list of common surnames and given-name syllables from
   the traditions the English corpus misreads (NGO, SEO, HUNG, TAN) or is
   unknown to the model. Many listed words are also English words, so beside
   an everyday word they do not count (RAM MODULE), and neither does an
   unknown word (ZORBEX ULTRA). This refuses WIDGET PRO, SEPA ACH, API KEY
   and invented brands, which pass the shape rule.
4. The second pass is skipped when neither person nor location detection is
   on, or when no rewritten word could join a name. A rewritten word joins one
   when it sits beside another word, with no field end between them, and is
   four or more letters or stands beside a second rewritten word. A field end
   is a quote beside a colon, comma or semicolon, as in "method": "POST". Any
   other gap (a space, comma, colon, quote, bracket or dash) may sit inside a
   name, as in JOHN "JACK" WHITFIELD or Robert: MILLER. Prose with OK, ID or
   USD and JSON with a quoted "POST" or "ERROR" cost one pass, since no span
   of one word can pass rule 2. With location on and person off it asks for
   places only.
5. Only PERSON spans, and LOCATION spans when location is redacted, come out
   of the second pass. LOCATION is there because the model reads some
   surnames as places (Costa Pereira), so a person-only pass left them in
   clear when written in capitals. Where two such spans overlap by cover, the
   wider survives, so a name is counted and redacted once, whole.

## Rationale / Trade-offs

Titlecasing restores the name cue on WHITFIELD and invents the same cue on
ERP. The shape and name-word rules are what price that: a 54-string corpus
of capitalised non-names (merchants, carriers, departments, SKUs, codes,
headings, acronym prose, particle-shaped places, non-places where a place
would go) keeps two known false people and no false place added by the
second pass. One predates the second pass, and the other is a product line
named after its founder, which holds a name. The side-by-side clause lifted
wholly capitalised names with a short word (AMY LEE) from 5 of 24 to 24 of
24 and particle surnames (VAN DER BERG) from 2 of 24 to 21 of 24, the
control's own ceiling. Without it, whether a name is protected would depend
on how long it is.

The name-word rule has its own price, and frequency alone set it by naming
tradition: it refused up to one capitalised Vietnamese name in eleven, and
Korean and Turkish names at 5 to 7%, because the corpus is English. The
bundled list is the answer to that, measured on names it was not built from:
over 480 capitalised names from twelve traditions in three trace sentences,
the rule refuses one (KIN FAI HO, a listed word beside two everyday ones),
and the other 144 of 1,440 cases still in clear are ones neither analysis
finds (main leaves 1,238). Of 51,072 pairings of common English forenames
and surnames, 1.3% are refused because they hold only everyday words
(ROSE WHITE, GRACE BROWN, GRACE LONG), which leaves them as they were before
the second pass. On 80 capitalised non-names in two trace sentences the branch
reports 10 of 160 as people or places against 8 on main; the extra two are
VELTRIX MAX, a brand word that is also a name. The list is a maintained
artefact: a tradition it does not cover pays the frequency price again, and
the fix is to add to the list, measured on held-out names.

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
run. The skip rule bounds that to those texts. The first skip rule fired on
any rewritten word of four letters, so a trace with "method": "POST" took
about twice the time (81.5 ms against 47.8 ms on a 1,365-character
payload) for a pass that could not keep a span. Requiring a neighbouring
word left the output of 3,100 recall and precision texts unchanged.

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
- Issues: langwatch/tasks#1049, #1055, #1057, #898, langwatch/langwatch#9252
