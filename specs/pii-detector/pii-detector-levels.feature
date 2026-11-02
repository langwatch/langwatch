Feature: PII detector service, Level 0 and Level 1
  As an engineer deciding how traces are redacted
  I want a self-contained detector that returns PII spans at a chosen level
  So that the cheap level and the model level can be run, measured and reviewed on their own

  # Level 0 is regular expressions and checksum validators: no models, no names.
  # Level 1 is Level 0 plus GLiNER multi-PII, PII-Tracer names above a score
  # threshold, and the name rule over all of them, so a name found once is
  # masked everywhere in the same text. The service is not wired into the
  # product; ADR-193 records why it is separate from the langevals Presidio path.
  #
  # Every test text is synthetic. The models are replaced by fakes, so the
  # tests need no torch, no ONNX runtime and no download.
  #
  # Bindings:
  #   services/piidetector/piidetector/
  #   services/piidetector/tests/

  @unit
  Scenario: Level 0 finds structured PII by pattern and checksum
    Given a text with an email address, a card number, an IBAN, a phone number and an IP address
    When Level 0 runs
    Then each of them is reported with its label and source "level0"

  @unit
  Scenario: A number that fails its checksum is not reported
    Given a card-shaped number that fails the Luhn check and an IBAN with a wrong check digit
    When Level 0 runs
    Then neither is reported

  @unit
  Scenario: A date is a date of birth only after a birth cue
    Given one date after "date of birth" and another date on its own
    When Level 0 runs
    Then only the date after the cue is reported as DATE_OF_BIRTH

  @unit
  Scenario: Level 0 does not report base64 strings or connection strings
    Given a text with a long mixed base64 string and a connection string with a password
    When Level 0 runs
    Then no API_KEY or CONNECTION_STRING span is reported

  @unit
  Scenario: Level 0 reports no person names
    Given a text that names a person
    When Level 0 runs
    Then no PERSON_NAME span is reported

  @unit
  Scenario: A name found once is masked everywhere in the text
    Given a text that names a person twice and a detector that found the first mention
    When the name rule runs
    Then the second mention is reported as PERSON_NAME with source "name_rule"

  @unit
  Scenario: A name written as Last, First is masked whole
    Given a detector found the given name in "Moreau, Lucie"
    When the name rule runs
    Then a PERSON_NAME span covers "Moreau, Lucie"

  @unit
  Scenario: Common capitalised words are not propagated as names
    Given a detected name span that includes a title and a greeting word
    When the name rule runs
    Then other occurrences of the title and the greeting word are not reported

  @unit
  Scenario: A name in a script without letter case is propagated whole
    Given a detected name written in Chinese characters that appears twice
    When the name rule runs
    Then both occurrences are reported

  @unit
  Scenario: The name rule does not extend a name over another entity
    Given a detected name followed by a comma and a word already covered by another label
    When the name rule runs
    Then the name is not extended over that word

  @unit
  Scenario: Level 1 keeps only confident Tracer names
    Given Tracer reports a name above its threshold, a name below it and an email
    When Level 1 combines the components
    Then only the name above the threshold comes from Tracer

  @unit
  Scenario: A span found by several components is reported once
    Given Level 0 and GLiNER report the same email span with and without a score
    When Level 1 combines the components
    Then the span is reported once with source "level0+gliner" and the GLiNER score

  @unit
  Scenario: A name only Tracer found is masked everywhere in the text
    Given Tracer found the first mention of a name that appears twice and GLiNER found neither
    When Level 1 combines the components
    Then both mentions are reported as PERSON_NAME

  @unit
  Scenario: The split layout returns the same spans as one process
    Given one process that runs Level 0 and GLiNER and another that runs Tracer
    When the caller combines their parts
    Then the spans equal those of one process running Level 1

  @unit
  Scenario: Long texts are windowed and the offsets point into the whole text
    Given a text longer than one model window with a name at the end
    When GLiNER and Tracer run
    Then the name span indexes the name in the whole text
    And the overlap between windows yields one span, not two

  @integration
  Scenario: A request needing a model this process did not load is refused
    Given a process that loaded Level 0 only
    When it receives a Level 1 request
    Then the request is refused as a bad request

  @integration
  Scenario: A text that fails reports its error class and nothing of the text
    Given a model that fails with a message quoting the text
    When a request with that text is handled
    Then the result for that text holds only the error class name

  @integration
  Scenario: The HTTP entrypoint serves the same contract
    Given the HTTP server with a loaded detector
    When a Level 0 request is posted to /detect
    Then the response holds the spans of each text in order
    And a body that is not JSON is answered with status 400
