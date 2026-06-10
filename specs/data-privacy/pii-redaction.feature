Feature: Redacting personal data from traces
  As a privacy-conscious customer
  I want personal data such as emails, phone numbers, and card numbers scrubbed
  from my traces
  So that I am not storing my end-users' personal information

  # PII redaction has three levels. "Essential" (the default) catches the common
  # pattern-based identifiers - emails, phone numbers, credit cards, IP
  # addresses, national IDs - and runs natively in the ingestion pipeline with
  # no external call, so it is fast and cheap. "Strict" additionally catches
  # names and locations, which need the heavier analysis service. "Disabled"
  # turns it off. Like secrets, detected PII is replaced with a redaction
  # placeholder, and the level is part of the same scoped privacy policy so it
  # inherits org -> department -> team -> project.

  Background:
    Given an organization "acme" with a project "web-app"

  @integration
  Scenario: Essential PII is redacted natively without calling the analysis service
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input contains an email address and a phone number
    Then the stored input has the email and phone number redacted
    And the analysis service was not called

  @integration
  Scenario: Essential level leaves names untouched
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input contains a person's name
    Then the stored input still contains the name

  @integration
  Scenario: Strict level redacts names using the analysis service
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested whose input contains a person's name
    Then the stored input has the name redacted
    And the analysis service was called

  @integration
  Scenario: Disabling PII keeps personal data
    Given a rule on "web-app" that disables PII redaction
    When a trace is ingested whose input contains an email address
    Then the stored input still contains the email address

  @integration
  Scenario: A credit card number is validated before being redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input contains a valid card number and a random 16-digit order id
    Then the stored input has the card number redacted
    And the order id is left intact
