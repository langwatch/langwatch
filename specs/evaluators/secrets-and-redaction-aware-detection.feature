Feature: Detecting secrets and seeing through privacy redaction in evaluators
  As a team that watches its traces for leaks
  I want the PII and secrets evaluators to still flag a leak that privacy
  redaction already scrubbed at ingestion
  So that turning on redaction does not silently turn every leak evaluation green

  # PII redaction and secrets redaction run at ingestion, BEFORE an evaluation
  # reads the stored content. If the evaluator only saw the scrubbed text it
  # would find nothing and always pass, hiding the very leaks it exists to catch.
  # Redaction therefore names what it removed with a typed marker
  # ([PHONE_NUMBER], [SECRET], ...), and the evaluators read those markers back:
  # a value that was redacted still counts as a detection. The markers are read
  # from every field the mapping fed the evaluator, so a secret hidden in a
  # mapped span attribute is covered just like input or output. The API Keys &
  # Secrets Detection evaluator runs natively in TypeScript, reusing the same
  # detection rules as redaction, with no analysis-service round-trip.

  Background:
    Given an organization "acme" with a project "web-app"

  @unit
  Scenario: The secrets evaluator flags a leaked key in trace content
    Given trace content carrying a live provider API key
    When the API Keys & Secrets Detection evaluator runs
    Then it fails and reports which secret rule matched

  @unit
  Scenario: The secrets evaluator scans every mapped field
    Given a secret carried only in a mapped span attribute, not input or output
    When the API Keys & Secrets Detection evaluator runs
    Then it still fails

  @unit
  Scenario: Clean content passes the secrets evaluator
    Given trace content with no credentials
    When the API Keys & Secrets Detection evaluator runs
    Then it passes with a score of zero

  @unit
  Scenario: A secret already redacted at ingestion is still flagged
    Given a secret that ingestion redaction replaced with a [SECRET] marker
    When the secrets evaluator result is augmented
    Then the evaluation fails even though the live scan found nothing

  @unit
  Scenario: PII redacted at ingestion still fails the PII detector
    Given content where a checked PII entity was replaced with its typed marker
    When the PII detection result is augmented
    Then the evaluation fails for that entity

  @unit
  Scenario: A redacted entity the evaluator is not checking is ignored
    Given a typed PII marker for an entity the evaluator has turned off
    When the PII detection result is augmented
    Then the evaluation is left unchanged

  @unit
  Scenario: Dropped content fails the detector
    Given the evaluator's content was dropped at ingestion and nothing else was mapped
    When the result is augmented
    Then the evaluation fails because a leak cannot be ruled out

  @unit
  Scenario: A populated mapped field is not failed by a dropped sibling
    Given input was dropped but a mapped attribute still carries clean content
    When the result is augmented
    Then the evaluation is left unchanged

  @unit
  Scenario: An evaluation error is never rewritten by the augmenter
    Given an evaluator returned an error
    When the result is augmented
    Then the error is preserved

  @integration
  Scenario: The secrets evaluator runs in-process as a guardrail
    When a guardrail call to the API Keys & Secrets Detection evaluator carries a leaked key
    Then it responds with a failed evaluation without calling the analysis service
