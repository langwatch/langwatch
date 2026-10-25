Feature: PII detection runs in Go with a pluggable analyser for names and places
  As a LangWatch operator
  I want PII detection served by the Go evaluator runtime, with the names-and-places analyser a configured choice
  So that Presidio can be retired and our own hosted model swapped in without code changes

  # Plan: dev/docs/plans/langevals-go-replacement.md §9. Pattern identifiers
  # are Go recognisers with Presidio's scores; only PERSON and LOCATION need a
  # model. The answer keeps Presidio's shape (findings and anonymised text), so
  # the application's redaction does not change. The application keeps the
  # policy, Google DLP and the connect decision; the runtime owns detection.

  @unit @unimplemented
  Scenario: Pattern identifiers are found without any analyser
    Given no names-and-places analyser is configured
    When the runtime analyses a text containing a credit card, an IBAN, a US SSN, an AU ACN and an IN passport number
    Then each is reported with its entity type and position
    And the anonymised text replaces each with its entity type

  @unit @unimplemented
  Scenario: A phone number with no context words scores as Presidio scored it
    Given a text containing a phone number and none of its context words
    When the runtime analyses it with the default threshold
    Then the phone number is not reported

  @unit @unimplemented
  Scenario: A context word lifts a pattern finding over the threshold
    Given a text containing "call me on" followed by a phone number
    When the runtime analyses it with the default threshold
    Then the phone number is reported

  @integration @unimplemented
  Scenario: The configured model service finds names and places
    Given the names-and-places analyser is the model service
    When the runtime analyses a text containing a person's name and a city
    Then the name and the city are reported
    And the model service was asked only for names and places

  @integration @unimplemented
  Scenario: Connect sends names and places to LangWatch's hosted model for an opted-in organisation
    Given an organisation that opted in to connect for PII
    When strict redaction analyses one of its spans
    Then the names and places are found by LangWatch's hosted model

  @integration @unimplemented
  Scenario: Connect is not used for an organisation that has not opted in
    Given an organisation that has not opted in to connect for PII
    When strict redaction analyses one of its spans
    Then no text is sent to LangWatch's hosted model

  @unit @unimplemented
  Scenario: With no analyser, names and places are left and the redaction is marked incomplete
    Given no names-and-places analyser is configured
    When strict redaction analyses a span containing a person's name and an email address
    Then the email address is redacted
    And the name is left in place
    And the redaction is marked incomplete on the trace

  @unit @unimplemented
  Scenario: A failing analyser falls back to the pattern identifiers
    Given the names-and-places analyser times out
    When strict redaction analyses a span containing a person's name and an email address
    Then the email address is redacted
    And the redaction is marked incomplete on the trace

  @unit @unimplemented
  Scenario: A model service reachable only over plain http is refused at boot
    Given the model service is configured with a plain http address
    When the runtime starts
    Then it refuses to start because the analyser key would travel unencrypted

  @unit @unimplemented
  Scenario: The analysed text never reaches LangWatch's own telemetry
    Given a text containing a marker string
    When the runtime analyses it for a project
    Then LangWatch's own span carries the entity counts and the analyser used
    And the marker string appears in no span or log line of LangWatch's own telemetry

  @integration @unimplemented
  Scenario: A replacement analyser matches Presidio before it becomes the default
    Given the labelled PII sample and Presidio's recorded answers on it
    When the candidate analyser analyses the sample
    Then its PERSON and LOCATION recall is at least Presidio's
    And its pattern-identifier findings match Presidio's
