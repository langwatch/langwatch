Feature: Redacting personal data from traces
  As a privacy-conscious customer
  I want personal data such as emails, phone numbers, and card numbers scrubbed
  from my traces
  So that I am not storing my end-users' personal information

  # PII redaction has four levels. "Essential" (the default) catches the common
  # pattern-based identifiers - emails, phone numbers, credit cards, IP
  # addresses, national IDs (including the Brazilian CPF) - and runs natively in
  # the ingestion pipeline with no external call, so it is fast and cheap.
  # "Strict" additionally catches names and locations, which need the heavier
  # analysis service. "Custom" lets a team pick exactly which identifiers to
  # redact: the pattern-based ones run natively, and any that need the analysis
  # service (names, locations) are sent there only when selected. "Disabled"
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

  # Strict layers names and locations on top of the essential entities. If the
  # analysis service is unreachable (or simply not configured in development),
  # strict must not leave everything exposed: the native essential pass still
  # scrubs emails, cards, and the other pattern-based identifiers, so the failure
  # mode is "names slip through" rather than "all personal data is stored".
  @integration
  Scenario: Strict falls back to the native essential floor when the analysis service is unavailable
    Given the resolved PII level for "web-app" is strict
    And the analysis service is unavailable
    When a trace is ingested whose input contains an email address and a person's name
    Then the stored input has the email address redacted
    And the stored input still contains the name

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

  # The Brazilian CPF (individual taxpayer registry) is a native essential
  # identifier, validated by its two check digits so a random eleven-digit number
  # is not mistaken for one. Because the strict level runs the native floor too,
  # CPF is covered at essential, strict, and custom alike.
  @integration
  Scenario: A Brazilian CPF is redacted at the essential level
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input contains a valid CPF and an eleven-digit number with bad check digits
    Then the stored input has the CPF redacted
    And the invalid number is left intact

  # The custom level redacts exactly the identifiers a team selects. The
  # pattern-based selections run natively; selections that need the analysis
  # service are sent there only when chosen, so a custom level made entirely of
  # native identifiers never calls out.
  @integration
  Scenario: A custom level redacts only the selected identifiers natively
    Given a rule on "web-app" with a custom PII level selecting emails and CPF
    When a trace is ingested whose input contains an email, a CPF, and a credit card number
    Then the stored input has the email and CPF redacted
    And the stored input still contains the credit card number
    And the analysis service was not called

  @integration
  Scenario: A custom level reaches the analysis service only for the identifiers that need it
    Given a rule on "web-app" with a custom PII level selecting person names
    When a trace is ingested whose input contains a person's name
    Then the stored input has the name redacted
    And the analysis service was called
