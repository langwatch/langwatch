Feature: The Go evaluator runtime detects PII as Presidio did
  presidio/pii_detection runs in nlpgo on Presidio's pattern recognizers,
  ported with their scores, checksums and context boosting. Names and places
  need a PII model an operator configures; nlpgo never embeds one.
  Plan: dev/docs/plans/langevals-go-replacement.md §9.

  @unit
  Scenario: Pattern PII findings match Presidio's, scores included
    Given the answers Presidio recorded for the pattern corpus
    When each case runs through the Go runtime
    Then status, score, passed, details, findings and anonymized text match

  @unit
  Scenario: Context words raise a finding's score as Presidio's do
    Given a finding whose recognizer lists context words
    When a context word is among the five keywords before it
    Then its score rises by 0.35, to at least 0.4 and at most 1.0

  @unit
  Scenario: A checksum failure is not a finding
    Given a value that matches a pattern but fails its checksum
    When the text is analyzed
    Then that value is not reported

  @unit
  Scenario: PERSON or LOCATION without a configured PII model is an entry error, not a pass
    Given no PII model is configured
    When an entry asks for PERSON or LOCATION
    Then the entry's result is an error naming the missing PII model

  @unit
  Scenario: Only entities patterns cannot find are sent to the PII model
    Given a PII model is configured
    When an entry asks for entities patterns cover and ones they do not
    Then the model is asked only for those patterns cannot find

  @unit
  Scenario: Entry text never reaches a log or a LangWatch span
    Given an entry containing PII
    When it is evaluated, including a failed PII model call
    Then no log line and no LangWatch-own span carries the entry text

  @unit
  Scenario: The anonymised text replaces each finding with its entity type, as Presidio's does
    Given findings that overlap, nest or sit a space apart
    When the text is anonymised
    Then each surviving span reads <ENTITY_TYPE>, resolved as Presidio's anonymizer does

  @unit
  Scenario: Text at the PII length limit full of numbers is analyzed in seconds
    Given an entry near the 524288 character limit made of numbers many recognizers match
    When the patterns analyze it
    Then the findings are deduplicated as Presidio's remove_duplicates does
    And the analysis takes seconds, not minutes, and stops between recognizers at the deadline
