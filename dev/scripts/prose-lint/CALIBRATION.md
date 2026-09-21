# Calibration

15 fixtures in `fixtures/`: 10 that break named rules and 5 clean texts (four docs pages in the four page shapes, one blog paragraph). `.mdx` fixtures run with `--rules both`, `.md` with `--rules writing`, since docs-only rules like "open a concept page with a definition" are not defects on a blog post. Labels are in `fixtures/expected.json`. A rule counts as fired at probability 0.7 or above; the table is what `node calibrate.mjs 0.7` printed on 2026-09-18.

## Result

Every rule with a positive fixture reaches 100% precision and 100% recall except `docs/artifact-as-subject`, which fires at 0.71 on `bad-docs-indefinite-event.mdx` ("A request carrying an expired token is refused with a 401", a plain state verb). That is one borderline miss out of 15 fixtures and 97 rules (42 docs, 56 writing, em dash shared); the same rule is exact on its own fixture and on the three docs pages, where every located sentence is a real cognitive or posture verb (settles, speaks, answers, honours, carries). The five clean fixtures fire nothing at 0.7.

Ten regex and local rules have no positive fixture (aspirational literal, "you may wish", "How to" titles, founder banned words, provider brand names, internal strategy vocabulary, fold/unfold, vague attribution, the one-sentence-paragraph barrage). They are deterministic string or count checks, so a fixture would only confirm the pattern compiles; they fired nothing on any clean fixture.

## What the calibration changed

The first pass had 20 false positives at 0.7. Reading each one against the rule text sorted them into two groups.

Eleven were correct by the rule's own letter and the fixture label was too narrow: "And it works!" is the gravitas-closer rule's own example; "the sample lands on long conversations" and "the file that the parameter names" in my clean fixtures use the exact verbs rule 17 lists; the artifact-verbs fixture also opens with "A failing scenario names the broken behavior", which is rule 26's shape; "Why teams choose Instant Evals" and "How the connection works" are rule 29's indirect form; the marketing fixture ends on a keynote closer and makes a vague scale claim (rule 5). Those became expected hits, or the clean fixture was rewritten to follow the rule.

Nine came from instructions that were too loose, and the fix was wording:

- `docs/wall-of-prose` fired on six of eight docs fixtures. It now asks for three or more steps or five or more reference values inside one paragraph, and says a short paragraph around a command is fine. Six false positives to zero.
- `docs/statement-stack` fired on a reference table and on a three-sentence paragraph with connectives. It now excludes tables, lists and code, and asks for three or more unconnected facts in running prose.
- `docs/infra-poetry` fired on "It injects its own tool map" and "A tunnel URL is public". It now names the register it means (abstract actors, dramatic verbs, no concrete component) and says plain component statements do not count.
- `docs/example-constructor` fired on a colon that introduced a list of cases. It now targets full-sentence examples only.
- `docs/paraphrased-artifact` fired at 0.70 on artifacts shown in inline code spans; the "no" criterion now names backticks as shown literally.
- `docs/artifact-as-subject` gained the plain state verbs (stays, is closed, is refused) as explicit non-hits.
- `writing/staccato` was the one false negative, 0.59 on the guide's own Andrew example. Putting the tic example first, giving a length ("under about eight words each"), and quoting two of the three sentences inside the yes criterion moved it to 0.9.

Two things about Jev's sensitivity to phrasing showed up. A criterion that quotes a concrete fragment ("like 'Overhead was high. Handoffs failed silently.'") moves a rule from 0.59 to 0.9 on the same text. And the judge matches quoted examples very literally: three of my first instructions quoted sentences from the docs pages under test, which made the pages fail on those rules by construction. They were replaced with the guides' own examples and the reports were re-run; the findings survived with the same located sentences, at slightly lower probabilities (0.94 to 0.89, 0.86 to 0.78).

## Per-rule table

Threshold 0.7. 15 fixtures, 30 requests, 138,513 input tokens, USD 0.0058.

| Rule | TP | FP | FN | Precision | Recall | Misses |
|---|---|---|---|---|---|---|
| docs/artifact-as-subject | 1 | 1 | 0 | 50% | 100% | FP bad-docs-indefinite-event.mdx (0.71) |
| docs/artifact-verbs-literal | 1 | 0 | 0 | 100% | 100% |  |
| docs/aspirational-claim | 0 | 0 | 0 | n/a | n/a |  |
| docs/bare-ai-gateway | 1 | 0 | 0 | 100% | 100% |  |
| docs/card-without-icon | 1 | 0 | 0 | 100% | 100% |  |
| docs/comparison-to-other-area | 0 | 0 | 0 | n/a | n/a |  |
| docs/concept-opener | 2 | 0 | 0 | 100% | 100% |  |
| docs/description-restated | 0 | 0 | 0 | n/a | n/a |  |
| docs/dev-process | 1 | 0 | 0 | 100% | 100% |  |
| docs/example-constructor | 0 | 0 | 0 | n/a | n/a |  |
| docs/filler-sentence | 1 | 0 | 0 | 100% | 100% |  |
| docs/heading-indirect-form | 2 | 0 | 0 | 100% | 100% |  |
| docs/heading-question-mark | 1 | 0 | 0 | 100% | 100% |  |
| docs/heading-unanswered | 0 | 0 | 0 | n/a | n/a |  |
| docs/indefinite-event-opener | 2 | 0 | 0 | 100% | 100% |  |
| docs/infra-poetry | 0 | 0 | 0 | n/a | n/a |  |
| docs/it-matters-because | 1 | 0 | 0 | 100% | 100% |  |
| docs/marketing-pitch | 1 | 0 | 0 | 100% | 100% |  |
| docs/marketing-words | 1 | 0 | 0 | 100% | 100% |  |
| docs/metaphorical-verb | 0 | 0 | 0 | n/a | n/a |  |
| docs/narration-in-concept | 0 | 0 | 0 | n/a | n/a |  |
| docs/pairs-with | 1 | 0 | 0 | 100% | 100% |  |
| docs/paragraph-over-80-words | 1 | 0 | 0 | 100% | 100% |  |
| docs/paraphrased-artifact | 0 | 0 | 0 | n/a | n/a |  |
| docs/preamble-opener | 1 | 0 | 0 | 100% | 100% |  |
| docs/product-casing | 1 | 0 | 0 | 100% | 100% |  |
| docs/release-flag | 1 | 0 | 0 | 100% | 100% |  |
| docs/restated-tool-guidance | 0 | 0 | 0 | n/a | n/a |  |
| docs/rides | 1 | 0 | 0 | 100% | 100% |  |
| docs/rollout-gate | 1 | 0 | 0 | 100% | 100% |  |
| docs/statement-stack | 0 | 0 | 0 | n/a | n/a |  |
| docs/timeline-narration | 0 | 0 | 0 | n/a | n/a |  |
| docs/title-repeated-as-heading | 1 | 0 | 0 | 100% | 100% |  |
| docs/tool-seat-expectations | 0 | 0 | 0 | n/a | n/a |  |
| docs/unshown-ui-element | 1 | 0 | 0 | 100% | 100% |  |
| docs/vague-boundary | 1 | 0 | 0 | 100% | 100% |  |
| docs/voice-and-tense | 0 | 0 | 0 | n/a | n/a |  |
| docs/wall-of-prose | 0 | 0 | 0 | n/a | n/a |  |
| writing/arrow-cta | 1 | 0 | 0 | 100% | 100% |  |
| writing/banned-words-2026-08-02 | 1 | 0 | 0 | 100% | 100% |  |
| writing/borrowed-structural-metaphor | 1 | 0 | 0 | 100% | 100% |  |
| writing/brand-closer | 0 | 0 | 0 | n/a | n/a |  |
| writing/clinical-hedge | 0 | 0 | 0 | n/a | n/a |  |
| writing/conspiratorial-hook | 1 | 0 | 0 | 100% | 100% |  |
| writing/dangling-demonstrative | 0 | 0 | 0 | n/a | n/a |  |
| writing/defensive-moat | 0 | 0 | 0 | n/a | n/a |  |
| writing/didnt-just-escalation | 0 | 0 | 0 | n/a | n/a |  |
| writing/ellipsis-shrug | 1 | 0 | 0 | 100% | 100% |  |
| writing/em-dash | 1 | 0 | 0 | 100% | 100% |  |
| writing/empty-summary-sentence | 0 | 0 | 0 | n/a | n/a |  |
| writing/exclamation-marks | 1 | 0 | 0 | 100% | 100% |  |
| writing/fake-epiphany | 0 | 0 | 0 | n/a | n/a |  |
| writing/grand-reframe | 0 | 0 | 0 | n/a | n/a |  |
| writing/gravitas-closer | 1 | 0 | 0 | 100% | 100% |  |
| writing/imperative-signoff | 0 | 0 | 0 | n/a | n/a |  |
| writing/interesting-literal | 1 | 0 | 0 | 100% | 100% |  |
| writing/invented-jargon | 0 | 0 | 0 | n/a | n/a |  |
| writing/keynote-closer | 1 | 0 | 0 | 100% | 100% |  |
| writing/load-bearing | 1 | 0 | 0 | 100% | 100% |  |
| writing/low-information-density | 0 | 0 | 0 | n/a | n/a |  |
| writing/magic-reframe | 1 | 0 | 0 | 100% | 100% |  |
| writing/marveling-at-ai | 0 | 0 | 0 | n/a | n/a |  |
| writing/mechanism-before-meaning | 0 | 0 | 0 | n/a | n/a |  |
| writing/most-vague-quantifier | 1 | 0 | 0 | 100% | 100% |  |
| writing/narrator-sentence | 1 | 0 | 0 | 100% | 100% |  |
| writing/negated-restart | 0 | 0 | 0 | n/a | n/a |  |
| writing/negation-reframe | 1 | 0 | 0 | 100% | 100% |  |
| writing/open-flat | 0 | 0 | 0 | n/a | n/a |  |
| writing/passive-voice | 0 | 0 | 0 | n/a | n/a |  |
| writing/personified-abstraction | 0 | 0 | 0 | n/a | n/a |  |
| writing/pronoun-chain | 0 | 0 | 0 | n/a | n/a |  |
| writing/pseudo-precision | 0 | 0 | 0 | n/a | n/a |  |
| writing/punchline-section-opener | 0 | 0 | 0 | n/a | n/a |  |
| writing/quoted-cliche-opener | 0 | 0 | 0 | n/a | n/a |  |
| writing/round-number-flex | 0 | 0 | 0 | n/a | n/a |  |
| writing/rule-of-three-anaphora | 0 | 0 | 0 | n/a | n/a |  |
| writing/second-order-abstraction | 0 | 0 | 0 | n/a | n/a |  |
| writing/staccato | 1 | 0 | 0 | 100% | 100% |  |
| writing/stating-priors | 0 | 0 | 0 | n/a | n/a |  |
| writing/teach-list-as-list | 0 | 0 | 0 | n/a | n/a |  |
| writing/two-beat-aphorism | 0 | 0 | 0 | n/a | n/a |  |
| writing/unintroduced-first-name | 1 | 0 | 0 | 100% | 100% |  |
| writing/unnamed-concept | 0 | 0 | 0 | n/a | n/a |  |
| writing/vague-specifics | 0 | 0 | 0 | n/a | n/a |  |
| writing/vibe-phrases | 1 | 0 | 0 | 100% | 100% |  |
| writing/vibe-phrases-literal | 1 | 0 | 0 | 100% | 100% |  |
| writing/voiceover-summary | 0 | 0 | 0 | n/a | n/a |  |
| writing/x-not-y-closer | 0 | 0 | 0 | n/a | n/a |  |

Rules that never fired on any fixture and were never expected are the silent majority; they are listed under 'Silent rules' below.

Silent rules (10): docs/em-dash, docs/aspirational-literal, docs/you-may-wish, docs/title-how-to, writing/founder-banned-words, writing/generic-provider-brand, writing/internal-strategy-vocab, writing/interface-internals-vocab, writing/vague-attribution, writing/one-line-paragraph-barrage
