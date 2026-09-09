Feature: Redacting personal data out of a span at ingestion

  Every span a customer sends is scrubbed once, at the door, and the original
  is never stored. That makes redaction the only chance to get it right: a
  detail this pass misses is in ClickHouse for the retention period, and a
  detail it removes cannot be recovered by anyone, support included.

  Two passes run, in this order. The NATIVE floor runs in process with no
  external call — the secrets scrubber and the pattern-and-checksum
  recognizers for the nineteen identifiers a regex can prove (emails, phones,
  cards, IBANs, national IDs). The STRICT escalation then sends what is left
  to an analysis service for the two things a regex cannot decide, names and
  locations. Running the floor first is what makes the escalation optional:
  an unreachable analysis service downgrades strict to essential and stamps
  the span, instead of storing it unredacted.

  This pass is moving out of the application ahead of the trace conversion, so
  for now two copies of it exist and neither compiles against the other. What
  they agree about is a data-protection contract between two processes writing
  into the same store, and drift in it is silent in the worst direction:
  nothing in a stored span records which identifiers were searched for, so a
  span scanned for eighteen of them and a span scanned for nineteen are the
  same row.

  @unit
  Scenario: The essential level scrubs in process and calls nothing
    Given a scope whose resolved policy names the essential PII level
    When a process redacts a span carrying an email address
    Then the address is replaced by its own typed marker
    And no external analysis call is made

  @unit
  Scenario: The floor covers every part of a span that carries text
    Given a scope whose resolved policy names the essential PII level
    When a process redacts a span with personal data in its events, links, status message and resource attributes
    Then every one of them is scrubbed

  @unit
  Scenario: The strict level runs the floor first and escalates for the rest
    Given a scope whose resolved policy names the strict PII level
    When a process redacts a span carrying both a name and an email address
    Then the analysis service receives text whose email address is already redacted
    And the name it returns is applied to the span

  @unit
  Scenario: A policy with exceptions narrows what leaves the process
    Given a scope whose resolved policy names the strict PII level and carries do-not-redact exceptions
    When a process redacts a span
    Then the analysis call asks only for the identifiers the native engine cannot detect

  @unit
  Scenario: A custom level sends only the identifiers it selected and the native engine cannot detect
    Given a scope whose resolved policy names a custom selection of identifiers
    When a process redacts a span
    Then the native engine handles the selections it can
    And the analysis service is asked only for the remaining selections
    And a selection the native engine covers entirely makes no external call

  @unit
  Scenario: An explicit policy level beats the level the ingestion call asked for
    Given a scope whose resolved policy names a level other than the platform default
    When a process redacts a span whose ingestion call asked for a different level
    Then the policy's level is the one enforced

  @unit
  Scenario: The ingestion call may escalate while the policy sits at the default
    Given a scope whose resolved policy is at the platform default
    When a process redacts a span whose ingestion call asked for the strict level
    Then the analysis service is called

  @unit
  Scenario: An unavailable analysis service marks the span rather than hiding the gap
    Given a scope whose resolved policy names the strict PII level
    And a deployment that named no analysis service
    When a process redacts a span outside production
    Then the native floor still scrubbed the pattern-based identifiers
    And the span carries the marker that says the deep redaction did not complete
    And redacting the same span again does not stamp the marker twice

  @unit
  Scenario: Production refuses a span it could not fully scrub
    Given a scope whose resolved policy names the strict PII level
    And an analysis service that cannot be reached
    When a production process redacts a span
    Then the span is refused rather than stored

  @unit
  Scenario: Nothing resolvable falls back to the analysis-service path unchanged
    Given a span whose scope has no resolvable policy
    When a process redacts it
    Then the analysis-service path runs at the level the ingestion call asked for

  @unit
  Scenario: The kill switch sends every span down the analysis-service path
    Given a deployment with the native enforcement kill switch set
    When a process redacts a span
    Then the native floor does not run
    And the analysis-service path runs

  @unit
  Scenario: A span past the batch ceiling is recorded as partly scanned
    Given a span with more text than one analysis batch may carry
    When a process redacts it
    Then the oversized value is left out of the batch
    And the span records whether some or none of it was scanned

  @unit
  Scenario: A batch answered with the wrong number of results is refused
    Given an analysis service that answers with fewer results than it was asked about
    When a process redacts a span
    Then the span is refused rather than having one value written over another

  @unit
  Scenario: A credential named by its attribute is scrubbed whatever it looks like
    Given a scope whose resolved policy has secrets redaction on
    When a process redacts a span carrying an authorization header attribute
    Then the whole value is replaced

  @unit
  Scenario: A record identifier stays addressable
    Given a scope whose resolved policy has secrets redaction on
    When a process redacts a span whose attribute name says the value is an identifier
    Then the identifier is left as it was
    And a real vendor credential parked under that name is still scrubbed

  @unit
  Scenario: A do-not-redact exception preserves its whole matched text
    Given a scope whose resolved policy carries a do-not-redact exception
    When a process redacts text the exception covers entirely
    Then the text is left as it was
    And a different finding of the same kind is still redacted
    And an exception matching only a prefix carves no hole out of a longer identifier

  @unit
  Scenario: A checksum-backed identifier is not redacted on shape alone
    Given text carrying a digit run shaped like a card number or a taxpayer id
    When a process redacts it
    Then a run that fails its checksum is left as it was
    And a run that passes is replaced by its own typed marker

  @unit
  Scenario: An ambiguous digit run needs a nearby word
    Given text carrying a bare nine-digit run
    When a process redacts it
    Then the run is left as it was
    And the same run beside the word that names it is redacted

  @unit
  Scenario: One attribute value that is a machine identifier keeps its shape
    Given an attribute value that is exclusively one identifier-shaped token
    When a process redacts it
    Then only the recognizers that prove their own finding run against it
    And the same digits in free text are still read as personal data

  @unit
  Scenario: The two identifier lists say the same thing in both processes
    Given the identifiers each redaction level covers
    Then the native list is the application's essential list, in its order
    And the analyzer list is the application's Presidio list, in its order
    And the two sides are disjoint and together cover the whole analyzer list
    And every identifier either engine detects can be named by a redaction marker

  @unit
  Scenario: The settings picker offers each identifier under the level that detects it
    Given the two label maps the custom picker renders
    Then the essential map is exactly the native engine's list
    And the strict-added map is exactly the identifiers only the analysis service detects
    And the Brazilian CPF is offered as essential, being the one native-only identifier

  @unit
  Scenario: The analysis request is the one the service expects
    Given a process that composed the analysis transport from its configuration
    When it sends a batch
    Then the request names the evaluate path, the level's entity list and the threshold
    And text past the scan ceiling is left unscanned and put back afterwards
    And the analyzer's angle-bracket markers are normalized to the platform's brackets

  @unit
  Scenario: The DLP fallback refuses by name when it is unavailable
    Given a deployment with Google DLP turned off or uncredentialed
    When the fallback is reached
    Then it refuses naming the variable that would enable it

  @unit
  Scenario: The DLP fallback masks a finding and honours an exception
    Given a credentialed Google DLP fallback
    When it inspects text carrying a finding
    Then the finding's range is replaced
    And a finding a policy exception covers entirely is left as it was

  @unit
  Scenario: An operator can see the analysis calls from either process
    Given the analysis metrics this process pushes
    Then they carry the application's three series names
    And each call, duration and outcome is counted under the application's labels

  @unit
  Scenario: The marker for an incomplete strict pass is the one the read path looks for
    Given the marker a partly-completed strict pass leaves behind
    Then it is the attribute name the application stamps

  @unit
  Scenario: The four privacy variables are read the way the application reads them
    Given a process resolving its configuration
    Then redaction is on without any of them being set
    And the native floor is turned off only by the application's own spelling
    And the DLP kill switch reads only the spellings the application reads
    And an unusable credentials document leaves DLP unavailable rather than failing the boot

  @unit
  Scenario: The privacy graph builds end to end from what the process already holds
    Given a composition root holding the privacy configuration, the data-privacy service and the feature flags
    When it builds the span redaction port
    Then a span carrying personal data comes back scrubbed
    And a deployment that named no analysis service still scrubs the native floor
