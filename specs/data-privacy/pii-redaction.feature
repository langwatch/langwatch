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

  # The hold-out above only bites when nothing claims to have PROVEN its finding.
  # A recognizer marked self-proving keeps running on an identifier-shaped value,
  # on the promise that it carries a checksum or a marker no machine identifier
  # holds by accident. Two of them did not keep that promise, and a trace id is
  # not recoverable once a marker is written over it, because redaction runs
  # before the event store.
  #
  # The bitcoin address pattern matched on shape alone - any 26 to 35 character
  # token that starts with "1" or "3" and avoids the four look-alike characters -
  # so roughly one in sixty random 32-character hex trace ids was stored as a
  # crypto marker, at every level including the default. It now verifies the
  # address checksum, so real addresses are still redacted and hex ids are not.
  # The card pattern accepted any digit run that passes the Luhn check, which a
  # thirteen-digit millisecond timestamp does about one time in ten. It now also
  # asks whether a card scheme could have issued that number at that length,
  # which the timestamps cannot be: the only scheme numbering from a leading one
  # issues fifteen digits, and timestamps are thirteen, sixteen or nineteen. The
  # rule is deliberately narrow, because a range excluded here is a real card
  # number stored in the clear, so every other leading digit is still accepted.

  @unit
  Scenario: An opaque trace identifier survives redaction at the default level
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is a hex trace identifier starting with a one
    Then the stored attribute still reads as it was sent

  @unit
  Scenario: A corpus of random hex identifiers survives the native engine intact
    Given the resolved PII level for "web-app" is essential
    When two thousand random hex trace identifiers are ingested as whole attribute values
    Then every stored attribute still reads as it was sent

  @unit
  Scenario: A real bitcoin address is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is a valid bitcoin address
    Then the stored attribute has the address redacted

  @unit
  Scenario: A taproot address is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute whose whole value is a valid taproot address
    Then the stored attribute has the address redacted

  # A checksum is only as narrow as the grammar behind it. The character after
  # the "bc1" prefix is the witness version, read from a thirty-two character
  # alphabet, and bitcoin defines only the first seventeen of those. A token
  # carrying one of the other fifteen decodes to no address at all, so treating
  # it as one would put a marker over a value that was never a payment address.
  @unit
  Scenario: A token using a witness version bitcoin does not define is not an address
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute holding a checksum valid token whose witness version is seventeen
    Then the stored attribute still reads as it was sent

  # The same argument one level down. A checksum covers the characters, not what
  # they mean, so a token can clear it and still encode no output anyone could
  # pay to: a payload that does not unpack to whole bytes, one shorter or longer
  # than any witness program, or a version zero payload that is neither of the
  # two lengths that version allows.
  @unit
  Scenario: A token whose witness program bitcoin does not allow is not an address
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with an attribute holding a checksum valid token whose witness program length is not one bitcoin allows
    Then the stored attribute still reads as it was sent

  # BIP-173 defines a segwit address as case-insensitive, and QR encoders emit
  # the uppercase form because uppercase packs into a QR alphanumeric segment.
  # A wallet address pasted from a QR scan is the same address as the lowercase
  # one and is redacted the same way. Mixed case is not an address at all, and
  # stays untouched.
  @unit
  Scenario: An uppercase segwit address is redacted like its lowercase form
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input holds a segwit address written in uppercase
    Then the stored input has the address redacted

  @unit
  Scenario: A millisecond timestamp is not read as a card number
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input holds a thirteen digit millisecond timestamp that passes the Luhn check
    Then the stored input still contains the timestamp

  @unit
  Scenario: A timestamp is not read as a card number at any of its widths
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input holds millisecond, microsecond and nanosecond timestamps that pass the Luhn check
    Then the stored input still contains every timestamp

  @unit
  Scenario: A timestamp from the 2040s is not read as a card number
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input holds a Luhn passing number inside the Mastercard range at a width Mastercard does not issue
    Then the stored input still contains the number

  @unit
  Scenario: Every card scheme in circulation is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input holds one valid card number from each scheme
    Then the stored input has every card number redacted

  @unit
  Scenario: A card number written without separators is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested whose input holds a card number written as one digit run
    Then the stored input has the card number redacted

  # The strict level adds names and locations, which need the external analysis
  # service. That service guesses from wording, and an opaque identifier gives it
  # nothing to go on, so it labels hex ids as people and places. Values are
  # therefore filtered before they leave the process: an attribute whose whole
  # value is one opaque identifier is never sent, and neither is an attribute
  # under one of the reserved trace and span identifier names whose value is
  # shaped like the address that name promises - hexadecimal, or a decimal run
  # of at most thirty-two digits. The name alone withholds nothing: anyone who
  # can write a span attribute can write one of those names, so a value that is
  # not an address is analysed like any other, which is what keeps an email
  # address parked under "metadata.trace_id" from being stored in the clear.
  #
  # "Opaque" has to be a high bar here, higher than the bar the native engine
  # uses, because holding a value back from this service is what stops a name or
  # a place ever being found in it. A value qualifies only when it carries a run
  # of at least sixteen letters and digits that no person would type: a hex
  # digest, or a run mixing letters with at least two digits. A hyphenated or
  # run-together name - "Elise-Marin-Van-Toren", "AnneMarieJohansson",
  # "Saint-Jean-Baptiste-Hospital" - has no such run, so it still goes for
  # analysis and is still redacted.
  #
  # Correlation attributes a customer fills in themselves - the user, customer,
  # thread and conversation identifiers - are deliberately NOT on the reserved
  # list. Customers routinely put an email address in them, and never analysing
  # them would store that email in the clear. They are covered by the same rule
  # as every other attribute: held back when the whole value is one opaque
  # identifier, analysed when it is personal data.

  @unit
  Scenario: An opaque identifier attribute value is never sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with an attribute whose whole value is a hex span identifier
    Then the analysis service never received that value
    And the stored attribute still reads as it was sent

  @unit
  Scenario: A reserved trace identifier attribute is never sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with a reserved trace identifier attribute
    Then the analysis service never received that value

  # The reserved names are not a namespace anyone owns. Attributes arrive on the
  # ingestion endpoint spelled exactly as the sender wrote them, so a sender can
  # put an email address under a trace identifier name - by mistake or on
  # purpose - and a rule that went on the name alone would then store that email
  # in the clear forever. The name earns the exemption only for a value that
  # could be the address it promises, which is to say hexadecimal or decimal.
  @unit
  Scenario: A reserved trace identifier name holding an email address is redacted at the strict level
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with a reserved trace identifier attribute whose value is an email address
    Then the stored attribute has the email address redacted
    And the analysis service never received the email address in the clear

  @unit
  Scenario: A reserved trace identifier name holding an email address is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a reserved trace identifier attribute whose value is an email address
    Then the stored attribute has the email address redacted

  # A decimal trace identifier and a card number are the same shape, so no rule
  # reading the value alone can separate them. What separates them is proof: the
  # reserved name stands the shape-only detectors down, the way it does for any
  # identifier, and leaves running the ones that can prove what they are looking
  # at. A number carrying a card checksum inside a range a scheme actually
  # issues is redacted whatever attribute it arrives under.
  @unit
  Scenario: A card number written under a reserved trace identifier name is still redacted
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a reserved trace identifier attribute whose value is a valid card number
    Then the stored attribute has the card number redacted

  # The reserved names buy an exemption from the two secret rules that judge a
  # token by its shape alone, because a trace identifier minted as a random body
  # looks exactly as random as a key. "traceid" and "spanid" carry no
  # underscore, so the ordinary rule for identifier-named attributes cannot
  # reach them and the reserved list is the only thing that can.
  #
  # That exemption reads the value too. The ingestion endpoint forwards
  # attribute names exactly as the sender wrote them, so a reserved name is a
  # claim by whoever sent the span and nothing more; if the name alone bought
  # the exemption, anyone could park a credential under "metadata.traceid" and
  # keep the shape rules off it.
  @unit
  Scenario: A reserved trace identifier name keeps the address it promises
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a reserved trace identifier attribute holding a decimal address
    Then the stored attribute still reads as it was sent

  @unit
  Scenario: A reserved trace identifier name does not exempt a credential
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a reserved trace identifier attribute holding a token only the shape rules can match
    Then the stored attribute has the token redacted

  # A decimal identifier of eleven digits is the shape of an international
  # phone number, and nothing in the value says otherwise. It is the one
  # decimal width where the reserved name changes what gets stored, which makes
  # it the case worth stating: every other width survives redaction whether the
  # name is reserved or not. The same value under an unreserved name is
  # redacted, so what is being described here is the name and not the value.
  @unit
  Scenario: A decimal trace identifier a phone detector claims is kept under a reserved name
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a reserved trace identifier attribute whose decimal value reads as a phone number
    Then the stored attribute still reads as it was sent
    And the same value under an unreserved attribute name has the phone number redacted

  # The reserved list earns its keep on exactly this case, so it is worth
  # stating on its own. The names without an underscore are the ones no other
  # rule can reach: an attribute ending in "_id" is already exempt by a suffix
  # rule older than this list, and a value long enough to look random is already
  # held back by its shape. A short decimal address under a name like "traceid"
  # has neither, so the reserved list is the only thing standing between it and
  # a phone-number marker written over it permanently.
  @unit
  Scenario: A reserved name keeps an address the shape rule is too short to see
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a short decimal trace address under a reserved name carrying no identifier suffix
    Then the stored attribute still reads as it was sent
    And the same value under an unreserved attribute name has the phone number redacted

  # A customer sending metadata to the ingestion endpoint does not have it
  # stored under the name they wrote. It is carried under one of the product's
  # own namespaces through ingestion and put back to its plain name only once
  # the trace is assembled, which is after redaction has had its say. There is
  # more than one such namespace and they all collapse to the same plain name,
  # so the reserved names have to be recognised under every spelling, or they
  # protect only a caller writing raw OpenTelemetry attributes by hand.
  #
  # This covers senders that put metadata in attribute NAMES: the ingestion
  # endpoint itself and the Go SDK. The Python and TypeScript SDKs send all
  # custom metadata as a single JSON-encoded attribute, which is unpacked after
  # redaction, so a reserved name inside that blob is not seen here at all.
  @unit
  Scenario: Caller metadata keeps a reserved trace identifier through the REST collector rewrite
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested whose caller metadata holds a reserved trace identifier written in decimal
    Then the stored metadata still reads as it was sent
    And the analysis service never received that value

  @unit
  Scenario: A corpus of opaque identifiers is never sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with attributes holding hex identifiers, dashed uuids and prefixed ULIDs
    Then the analysis service received none of them

  @unit
  Scenario: A corpus of short opaque tokens is almost never sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with twelve hundred short hex span identifiers and prefixed ULIDs
    Then the analysis service received fewer than one in a hundred of them

  @unit
  Scenario: A corpus of written names is still sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with two thousand generated names as attribute values
    Then the analysis service received every one of them

  @unit
  Scenario: Prose that holds a name is still sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with an attribute whose value is a sentence naming a person
    Then the analysis service received that sentence

  # Holding a value back is decided on the WHOLE value, never on a part of it.
  # Carrying an identifier is not the same as being one: a sentence that quotes
  # a trace id is still a sentence, and the words around the id are exactly what
  # the analysis pass exists to read. Deciding on a part would mean any message
  # with a request id in it stopped being scanned for names.
  @unit
  Scenario: Prose that quotes an opaque identifier is still sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with an attribute whose value is a sentence naming a person next to a trace identifier
    Then the analysis service received that sentence

  @unit
  Scenario: A customer identifier that holds a person name is still sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with a user identifier attribute whose value is a person name
    Then the analysis service received that value

  @unit
  Scenario: A hyphenated or run-together name is still sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with attributes holding names written with hyphens, with dots and with no separator at all
    Then the analysis service received every one of them

  @unit
  Scenario: A place written as one hyphenated token is still sent for analysis
    Given the resolved PII level for "web-app" is strict
    When a trace is ingested with an attribute whose value is a hyphenated place name
    Then the analysis service received that value

  @unit
  Scenario: A reserved identifier attribute survives even when its value is all digits
    Given the resolved PII level for "web-app" is essential
    When a trace is ingested with a reserved trace identifier attribute written in decimal
    Then the stored attribute still reads as it was sent

  @unit
  Scenario: Log attributes hold opaque identifiers back from analysis
    Given the resolved PII level for "web-app" is strict
    When a log record is ingested with an attribute whose whole value is a hex identifier
    Then the analysis service never received that value
    And the analysis service received the log body

  @unit
  Scenario: Metric attributes hold opaque identifiers back from analysis
    Given the resolved PII level for "web-app" is strict
    When a metric is ingested with one attribute holding a hex identifier and another holding prose
    Then the analysis service never received the identifier
    And the analysis service received the prose

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
  # Bindings: platform/app/src/server/data-privacy/redaction/__tests__/essentialPii.prefilter.unit.test.ts
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
