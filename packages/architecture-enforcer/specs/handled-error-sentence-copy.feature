Feature: A failure built in module code carries its code, not customer copy
  A failure built in module contract or process code as a `{ code, message }` value, whose
  `message` is an English sentence meant for the customer, authors the customer's words outside
  the presentation registry. The failure carries its code and the meta the copy needs; the words
  are that code's entry in packages/handled-error/src/presentation.ts. Shrink-only:
  tests/baselines/handled-error-sentence-copy.json holds each file's count.

  Sentence copy, tightly: the `message` value is a string literal, or a template whose leading
  text before any substitution opens with a capitalised word followed by at least one more
  space-separated word. A code slug, a template that opens on a substitution and a message read
  from a variable are not sentence copy. A zod issue (`code: "custom"`, `z.ZodIssueCode.custom`,
  or an `addIssue` argument) is validation copy, a log line has no code beside its message, and an
  in-memory stand-in for a vendor's API (`channels/memory/`) mimics that vendor's own text: none of
  them is governed. The policy prefers a missed finding to a false one.

  See dev/docs/plans/platform-architecture-blocks.md rule 8 (Alex, 2026-10-20).

  @unit @architecture
  Scenario: A coded failure with a sentence message is reported
    Given a thrown error payload, a returned result and a template message, each with a code and a capitalised sentence as its message
    When the handled-error-sentence-copy policy reads module contract and process code
    Then it reports each of the three on the message line

  @unit @architecture
  Scenario: A slug, a variable or a zod issue is accepted
    Given coded failures whose message is a code slug, a variable, a template opening on a substitution, or a zod issue
    When the handled-error-sentence-copy policy reads module contract and process code
    Then it reports nothing

  @unit @architecture
  Scenario: Tests, vendor stand-ins and browser code are left alone
    Given a test file, a channels/memory stand-in and a browser file that build a coded failure with a sentence message
    When the handled-error-sentence-copy policy reads module code
    Then it reports nothing

  @unit @architecture
  Scenario: The report sends the words to the presentation registry
    Given a coded failure with a sentence message
    When the handled-error-sentence-copy policy reports it
    Then the finding names the presentation registry and keys the count by file

  @unit @architecture
  Scenario: No file gains a coded failure with sentence copy
    Given the tree's coded failures whose message is customer sentence copy
    When the findings are counted per file
    Then none is above tests/baselines/handled-error-sentence-copy.json and every listed count is still reached
