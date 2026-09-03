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

  # Falling back silently would let names slip through with no sign that strict
  # redaction did not fully run, so a reader assumes the trace is fully scrubbed
  # when it is not. When strict cannot reach the analysis service the trace is
  # marked: the view tells the reader that name and location redaction did not
  # run, so the gap is visible rather than silent.
  @integration
  Scenario: An incomplete strict redaction is marked on the trace
    Given the resolved PII level for "web-app" is strict
    And the analysis service is unavailable
    When a trace is ingested whose input contains a person's name
    Then the trace is marked that strict PII redaction did not complete
    And the marker explains that names and locations may not be redacted

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

  # Phone numbers are the one essential identifier with neither a checksum nor a
  # nearby word to confirm them: any digit run that reads as a dialable number
  # matches. Machine identifiers hit that by accident, so a datestamped id such
  # as "hosted-eu-20260812-09" was stored as "hosted-eu-[PHONE_NUMBER]". Two
  # rules keep such identifiers whole. An attribute value that is exclusively
  # one identifier-shaped token (letters together with digits, a uuid, a hex
  # digest) is scanned only for the identifiers that prove themselves, which are
  # the checksum-validated ones and email addresses. And a phone number that
  # sits inside a longer token carrying letters is kept everywhere, prose
  # included. A value of digits and separators alone keeps no exemption, so a
  # phone number written on its own is still redacted.

  @unit
  Scenario: A datestamped identifier attribute value is not read as a phone number
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is the identifier "hosted-eu-20260812-09"
    Then the stored attribute still reads "hosted-eu-20260812-09"

  @unit
  Scenario: A digit run that reads as a phone number is still redacted in a sentence
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input reads "ref 2026081209 checkpoint"
    Then the stored input has the digit run redacted as a phone number

  @unit
  Scenario: An identifier mentioned inside a sentence keeps its digits
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input mentions the identifier "hosted-eu-20260812-09" between words
    Then the stored input still contains the whole identifier

  @unit
  Scenario: A phone number that is the whole attribute value is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is an international phone number
    Then the stored attribute has the phone number redacted

  @unit
  Scenario: A value of digits and separators with no letters is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is a digit run with a separator
    Then the stored attribute has the digit run redacted as a phone number

  @unit
  Scenario: A uuid or a digest attribute value is left alone
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with attributes whose whole values are a uuid and a hex digest
    Then the stored attributes still read as they were sent

  @unit
  Scenario: A host identifier that embeds an address is left alone
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is the host identifier "pod-10.0.0.1"
    Then the stored attribute still reads "pod-10.0.0.1"

  @unit
  Scenario: A card number inside an identifier-shaped value is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is a reference holding a valid card number
    Then the stored attribute has the card number redacted

  @unit
  Scenario: An email address that is the whole attribute value is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is an email address with digits in it
    Then the stored attribute has the email address redacted

  # Detection heuristics over-trigger on business identifiers that merely look
  # like PII: a 14-digit reservation number reads as a credit card, an
  # "orders@acme.internal" queue address reads as a personal email. Exception
  # patterns are the release valve: a scope lists regexes for its own known-safe
  # formats, and a detected span whose ENTIRE matched text matches one of them
  # is left as it was. Exceptions never widen detection; they only veto
  # individual matches, and everything else in the same text is still redacted.
  # Like custom secret patterns they union down the cascade and are validated
  # (compile + ReDoS analysis) at save time, never at ingestion.

  @integration
  Scenario: An exception pattern keeps a business identifier while other PII is still redacted
    Given a rule on "web-app" with an exception pattern for 14-digit numbers starting with "00"
    When a trace is ingested whose input contains a 14-digit reservation number starting with "00" and an email address
    Then the stored input still contains the reservation number
    And the stored input has the email address redacted

  @integration
  Scenario: An exception must cover the whole detected value
    Given a rule on "web-app" with an exception pattern for the literal prefix of an email domain
    When a trace is ingested whose input contains an email address on that domain
    Then the stored input has the email address redacted

  @integration
  Scenario: Exception patterns union down the cascade
    Given a rule on organization "acme" with an exception pattern for reservation numbers
    And a rule on "web-app" with an exception pattern for internal queue addresses
    When a trace is ingested whose input contains a reservation number and an internal queue address
    Then the stored input still contains both identifiers

  # At the strict level the analysis service re-scans for names and locations.
  # When exceptions are configured, the pattern-based identifiers are handled
  # exclusively by the native pass (where exceptions apply), and the analysis
  # service is scoped to the identifiers only it can detect, so it cannot
  # re-redact a value an exception kept.
  @integration
  Scenario: Exceptions hold at the strict level
    Given a rule on "web-app" with the strict PII level and an exception pattern for reservation numbers
    When a trace is ingested whose input contains a reservation number
    Then the stored input still contains the reservation number

  @integration
  Scenario: An unsafe exception pattern is rejected when saving the rule
    When an admin tries to save a PII exception pattern that is a catastrophic-backtracking regex
    Then the request is rejected with a validation error

  # An exception is the only pattern in this feature that REMOVES redaction, so
  # a catch-all fails open rather than closed: anchored to the whole detected
  # span, something like ".*" or "\d+" matches every finding and turns the PII
  # pass off entirely while the level still reads as active in the UI. Save-time
  # validation rejects a pattern that matches values of unrelated kinds, so an
  # exception has to describe one identifier shape. A too-broad custom SECRET
  # pattern only over-redacts, so it is not held to this.
  @integration
  Scenario: An over-broad exception pattern is rejected when saving the rule
    When an admin tries to save a PII exception pattern that matches any value
    Then the request is rejected with a validation error
    And a pattern describing one specific identifier shape is still accepted

  # Detectors that cannot match without a particular character are skipped on
  # text that does not contain it — an address pattern never runs on text with
  # no "@" in it. This is a speed change with no behaviour attached: on that
  # text the detector would have found nothing anyway. It earns its place
  # because these patterns are scanned from every position, and the address one
  # alone was a measurable share of ingestion time.
  #
  # The risk is a detector claiming a character it does not truly need, which
  # would stop it finding real personal data. The scenarios below are the ones
  # that would fail if that happened.
  #
  # Bindings: packages/redaction/src/__tests__/essentialPii.prefilter.unit.test.ts
  @unit
  Scenario: Personal data is still redacted when the text holds no address marker
    When a trace is ingested whose input contains a card number, an IBAN, an IP
      address and a social security number, and no address marker anywhere
    Then all four are still redacted

  @unit
  Scenario: Skipped detectors still find their own kind of personal data
    When a trace is ingested whose input contains an email address, a wallet
      address and an IPv6 address
    Then each one is redacted

  @unit
  Scenario: A long value holding no personal data is returned unchanged
    When a trace is ingested whose input is a long opaque token
    Then the stored input is byte-for-byte what was sent

  # Phone numbers are the same idea again, counted in digits rather than in
  # characters: text whose longest run of digits is shorter than any phone
  # number is skipped. A trace full of version numbers, token counts and
  # timestamps is the ordinary case, and it used to cost more than the rest of
  # redaction together.
  #
  # A phone number is redacted wherever its country writes it, so the shortest
  # number in use anywhere stays above the length that decides the skip.

  @unit
  Scenario: A phone number is redacted whatever country it belongs to
    When a trace is ingested whose input contains phone numbers from every
      country, written the way each country writes them
    Then every one of them is redacted

  @unit
  Scenario: Numeric text that is no phone number is left alone
    When a trace is ingested whose input carries version numbers and counts but
      no run of digits long enough to be a phone number
    Then the stored input is unchanged
