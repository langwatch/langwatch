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
  Scenario: The analysis request turns off every identifier the call did not ask for
    Given a custom selection whose only analysis-service identifier is person names
    When the batch is sent to the analysis service
    Then the request asks for person names
    And it turns off credit card numbers, email addresses and every other identifier by name

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

  # The batch ceiling is cumulative over every value in one span, and what caps
  # it is latency: one analysis request must answer before the gateway gives up.
  # A process that injected no usable number falls back to the same default the
  # service holds, so the wiring and the fallback cannot drift apart.
  @unit
  Scenario: A span at the budget is analysed and one character more is not
    Given a process that injected no usable per-span analysis budget
    When it redacts a span whose text exactly fills the default budget
    Then the span is analysed
    And a span one character larger has that value left out of the batch

  # Fitting the per-span batch is not the same as fitting one analysis pass: a
  # pass reads a bounded prefix of a single text and puts the remainder back
  # untouched. Saying nothing would store that unread tail as if it were clean,
  # so a value longer than one pass marks the span even though it was sent.
  @unit
  Scenario: A value longer than one analysis pass leaves the span partly scanned
    Given a span carrying one value longer than a single analysis pass may read
    When a process redacts it
    Then the value is analysed and written back
    And the span records that only part of it was scanned

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
    Then the analysis service is asked to detect the level's entity list for the batch
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
    Then redaction is on without any variable being set
    And the native floor is turned off only by the application's own spelling
    And the DLP kill switch is carried as the deployment wrote it

  @unit
  Scenario: The privacy graph builds end to end from what the process already holds
    Given the booted data-privacy module with no analysis service named
    When a peer asks it to redact a span carrying an email address
    Then the span comes back scrubbed by the native floor

  @unit
  Scenario: A peer redacts a span through the data-privacy API
    Given a span whose input carries an email address
    When a peer hands it to the data-privacy API's span redaction at the essential level
    Then the address is redacted in place

  @unit
  Scenario: Whether the analysis service is configured is asked once
    Given a process whose configuration names the analysis service's endpoint
    When the redaction pass asks whether the analysis service is configured
    Then it asks the analysis service with an empty batch that sends nothing
    And it asks again only after an answer failed

  # The PII redaction model: a second analysis service on Presidio's own
  # exchange, for allowlisted organizations only. It never weakens today's path:
  # anything other than a clean answer falls back to Presidio, then Google DLP.

  @unit
  Scenario: An allowlisted organization's strict analysis goes to the PII redaction model
    Given a deployment that names the PII redaction model
    And the project's organization is allowlisted for it
    When a strict batch is analysed
    Then the model answers it and Presidio is not called

  @unit
  Scenario: Only a batch whose effective PII level is strict reaches the PII redaction model
    Given a deployment that names the PII redaction model
    And the project's organization is allowlisted for it
    When a batch whose request level is STRICT is analysed
    Then the model answers it when the project's resolved policy is strict, for spans and log records alike
    And the model answers it when the resolved policy is essential, which the STRICT request raises to strict
    And Presidio answers it when the resolved policy is custom, even with every analysis-service entity selected
    And Presidio answers it when the project's policy could not be loaded
    And in both of those cases the model is not called and the flag is not read

  @unit
  Scenario: An organization not allowlisted keeps the Presidio path
    Given a deployment that names the PII redaction model
    And the project's organization is not allowlisted for it
    When a strict batch is analysed
    Then Presidio answers it and the model is not called
    And a span redacted through the whole module never invokes the model's Lambda

  # Self-hosted, the model comes with the Enterprise licence and has no usage price. Routing
  # follows the organization's active plan. Unlike SSO, an expired licence does not keep the
  # model: entitlement resolves it to the baseline plan, so the batch stays on Presidio.

  @unit
  Scenario: A self-hosted organization without an Enterprise licence keeps the Presidio path
    Given a self-hosted deployment that names the PII redaction model, with its flag forced on
    And the organization's active plan is not Enterprise
    When a strict batch is analysed
    Then Presidio answers it and the model is not called
    And the batch is counted with the reason not_licensed
    And the organization logs one usage line a minute at most, not one per batch
    And nothing is priced

  @unit
  Scenario: A self-hosted organization with an Enterprise licence goes to the PII redaction model
    Given a self-hosted deployment that names the PII redaction model, with its flag forced on
    And the organization's active plan is Enterprise
    When a strict batch is analysed
    Then the model answers it and Presidio is not called

  @unit
  Scenario: A self-hosted organization whose Enterprise licence expired keeps the Presidio path
    Given a self-hosted deployment that names the PII redaction model, with its flag forced on
    And the organization's Enterprise licence has expired, so its active plan is the baseline plan
    When a strict batch is analysed
    Then Presidio answers it and the model is not called
    And the batch is counted with the reason not_licensed

  @unit
  Scenario: A self-hosted organization's plan is read once a minute
    Given a self-hosted deployment that names the PII redaction model, with its flag forced on
    When several strict batches of one organization are analysed within a minute
    Then the organization's plan is read once
    And a plan that cannot be read sends the batch to Presidio with the reason routing_error

  @unit
  Scenario: LangWatch Cloud routes the model without reading the plan
    Given a LangWatch Cloud deployment that names the PII redaction model
    And the organization is allowlisted for it, on a plan other than Enterprise
    When a strict batch is analysed
    Then the model answers it and the plan is not read

  # On LangWatch Cloud a priced organization reaches the model only once an organization admin
  # accepted its price (ADR-201 decision 15). An organization on Strict without a recorded
  # acceptance, including one that confirmed the price before this change, keeps rule-based
  # detection (Presidio) at no charge until an organization admin accepts again, however Strict
  # was set. The free list needs no acceptance, and self-hosted never reads either.

  @unit
  Scenario: A Strict organization that never accepted the price stays on Presidio, unbilled
    Given a LangWatch Cloud deployment that names the PII redaction model
    And the organization is allowlisted for it, not on the free list, with no recorded acceptance of its price
    And a price it confirmed before this change left no acceptance on record
    When a strict batch is analysed
    Then Presidio answers it and the model is not called
    And the batch is counted with the reason not_accepted
    And the organization logs one usage line a minute at most, not one per batch
    And nothing is priced

  @unit
  Scenario: Strict set through the API, project settings or a rule stays on Presidio until the price is accepted
    Given a LangWatch Cloud organization with the model flag on, not on the free list, that never accepted the price
    When its project is set to Strict through project settings or the API, or its organization rule is set to Strict
    And the project sends a span
    Then Presidio redacts the span, the model is not called and nothing is priced

  @unit
  Scenario: An organization that accepted the price goes to the model and is priced
    Given a LangWatch Cloud organization with the model flag on, not on the free list
    And an organization admin accepted the model's price
    When a strict batch is analysed
    Then the model answers it and one priced fact is recorded at the published rate

  @unit
  Scenario: An organization on the free list reaches the model with no acceptance
    Given a LangWatch Cloud organization with the model flag on and on the free list, that never accepted the price
    When a strict batch is analysed
    Then the model answers it and the call is recorded at a price of zero
    And whether the organization accepted the price is not read

  @unit
  Scenario: The free list and the acceptance are read once a minute per organization
    Given a LangWatch Cloud organization with the model flag on
    When several strict batches of the organization are analysed within a minute
    Then its free-list entry and its acceptance are each read once
    And a free list or an acceptance that cannot be read sends the batch to Presidio with the reason routing_error, priced for nobody

  @unit
  Scenario: A free-list change during a model call never prices that call
    Given a LangWatch Cloud organization on the free list when its batch is routed to the model
    When the organization leaves the free list while the model is still answering
    Then the call is recorded at a price of zero, as it was routed
    And the free list is not read again to price it

  @unit
  Scenario: A model failure falls back to Presidio, never to unredacted text
    Given an organization allowlisted for the PII redaction model
    When the model refuses, runs out of time, or its routing cannot be decided
    Then the batch is sent to Presidio
    And when Presidio fails too, the Google DLP fallback is reached as today

  @unit
  Scenario: A slow model call is aborted at 50 seconds
    Given an organization allowlisted for the PII redaction model
    When the model has not answered after 50 seconds
    Then the model invoke is aborted, not just left running in the background
    And the batch is sent to Presidio, which gets its own full 60 second timeout
    And a batch that neither answers reaches Google DLP after 110 seconds at most

  @unit
  Scenario: A model that times out is skipped for two minutes
    Given an organization allowlisted for the PII redaction model
    When a model call in this process times out or is throttled
    Then for the next two minutes every routed batch goes straight to Presidio without calling the model
    And each such batch logs its usage line and is counted with the reason breaker_open
    And after two minutes one batch tries the model while the others still go to Presidio
    And when that try answers, every batch goes to the model again
    And when that try times out too, the model is skipped for another two minutes
    And a refusal or a bad answer does not skip the model
    And a batch that set off before the timeout and answers late does not end the cool-down

  @unit
  Scenario: A deployment that names no model behaves exactly as today
    Given PII_REDACTION_MODEL_ENDPOINT is not set
    When a strict batch is analysed
    Then Presidio answers it
    And neither the flag nor the project's organization is read
    And a span redacted through the whole module sends no request to any model

  @unit
  Scenario: The model's Lambda answer is read through the Web Adapter prelude
    Given the model reached through its Lambda alias
    When a batch is sent
    Then the invoke is an HTTP event for the Presidio route
    And only a framed 2xx answer with one result per text is accepted
    And a missing prelude, a non-2xx status, a function error or a truncated answer is refused

  @unit
  Scenario: A long batch skips the model and goes to Presidio
    Given an organization allowlisted for the PII redaction model, with splitting off
    When a strict batch holds more than 8,000 characters in all its texts
    Then Presidio answers it and the model is not called
    And a batch of many short texts counts the same as one long text
    And its usage line records the outcome too_long

  # ADR-207: a long Strict span split across model calls by the caller.

  @unit
  Scenario: With splitting on, a long batch is split across model calls and masked where the model found it
    Given an organization allowlisted for the PII redaction model, with splitting on
    When a strict batch holds between 8,001 and 32,000 characters in all its texts
    Then every split call to the model carries at most 4,000 characters
    And a text over 4,000 characters is cut at whitespace into pieces, each repeating at least the last 200 characters of the one before it
    And a piece that would be under 2,000 characters is cut inside a word instead, the overlap covering that cut
    And only after a whitespace run longer than 800 characters may the next piece repeat less, as no value spans it
    And texts of 4,000 characters or less are packed whole into calls
    And every finding is masked on the characters the model found it on
    And Presidio is not called

  @unit
  Scenario: The 8,000 and 32,000 character limits route a batch to one call, split calls or Presidio
    Given an organization allowlisted for the PII redaction model, with splitting on
    When a strict batch holds 8,000, 8,001, 32,000 or 32,001 characters, counted after Essential masking as today
    Then 8,000 goes to the model in one call, 8,001 and 32,000 are split, and 32,001 goes to Presidio

  @unit
  Scenario: A whole text in a split call keeps the model's own masked text
    Given a split batch that also holds a short JSON text and a short spared text, each sent whole
    When the model answers them
    Then each keeps exactly the masking a single call would give it

  @unit
  Scenario: A name, an address or an IBAN across a cut is masked whole and nothing found is left unmasked
    Given a split batch with names, addresses and IBANs planted at the 4,000 and 8,000 character cuts and across the overlap
    When the model finds each of them in the pieces it sees
    Then the masked text equals the text with each planted value replaced by its marker, and every other character unchanged
    And a name found short in one piece and whole in the next is masked over the widest range, labelled by the higher-scoring finding

  @unit
  Scenario: A batch over 32,000 characters skips the model even with splitting on
    Given an organization allowlisted for the PII redaction model, with splitting on
    When a strict batch holds more than 32,000 characters in all its texts
    Then Presidio answers it and no model is called
    And its usage line records the outcome too_long

  @regression
  Scenario: A piece the model could reshape sends the whole span to Presidio
    Given a split batch
    When one of its pieces holds a backslash and reads as JSON on its own, NaN and Infinity included
    Then Presidio answers the whole batch and no piece's findings are used
    And a piece is never cut to start or end on a character the model trims, U+0085 included

  @regression
  Scenario: A long text sent again is cleared from the first answer, not sent to the model again
    Given an organization on the PII redaction model
    And a span whose texts are a 3,000-character system prompt and a short user message
    When a second span within ten minutes carries the same system prompt and a new message
    Then the model is sent only the new message
    And the system prompt is cleared as the model cleared it the first time
    And each span is priced on all its characters, as it would be without the repeat

  @unit
  Scenario: A held text is reused only in the same scope and for ten minutes
    Given a process holds the model's clearing of a 2,500-character text
    When the same text comes from another organisation, at another level, with other entities or another spared flag
    Then it is sent to the model again
    And after ten minutes, or once 256 newer texts are held, it is sent again too
    And a text under 2,000 characters is never held

  @regression
  Scenario: The whole span passes the size limits before held texts are left out
    Given a process holds the model's clearing of some of a span's texts
    When the whole span is over 8,000 characters with splitting off, or over 32,000 with it on
    Then the span goes to Presidio and is priced for nobody, as it would with nothing held
    And a span whose every text is held is priced on all its characters with no model call

  @regression
  Scenario: A text cut only because its span was long is not reused where it would go whole
    Given a 5,500-character text that was cut into pieces beside another long text
    When the same text comes back alone, short enough for one call
    Then the model is sent it again in one call, never served the cut answer

  @regression
  Scenario: A long escaped JSON message list splits and every piece is placed
    Given a span whose text is an OpenTelemetry message list of 20,000 characters with escaped quotes and newlines
    When the batch splits
    Then every cut piece is placed by its offsets, since a cut through the list never reads as JSON
    And the model's escapes are left as they are in the stored text

  @unit
  Scenario: A piece whose findings do not rebuild the model's own masked piece sends the whole span to Presidio
    Given a split batch whose piece the model answers with findings that do not rebuild its own masked text
    Then Presidio answers the whole batch
    And a piece with an emoji before a name still places the name's mask on the name

  @unit
  Scenario: One failed split call sends the whole span to Presidio and nothing is stored unmasked
    Given a split batch with two calls in flight
    When one call fails, times out or is throttled while the other is still running
    Then Presidio's answer for the whole batch is returned without waiting for the other call
    And no answer of the other call is used
    And a call the model refuses (not configured, a result missing or failed) counts as failed

  @unit
  Scenario: With no free split slot, a long batch goes to Presidio at once as busy
    Given a process whose split slots are all taken by other spans
    When a split batch arrives
    Then Presidio answers it without waiting for a slot
    And its usage line records the outcome busy

  @unit
  Scenario: A split span runs up to six calls at once and its later pieces on the slots it holds
    Given a split batch of five pieces and two free split slots
    Then at most two of its calls are in flight at once and all five pieces are sent
    And with one free slot its pieces are sent one after another
    And a batch whose pieces cannot fit the 50 second budget goes to Presidio before any call

  @unit
  Scenario: A split span gets 50 seconds for all its calls, then goes to Presidio
    Given a split batch whose calls do not all answer within 50 seconds of the first one starting
    When the 50 seconds pass
    Then Presidio answers the whole batch
    And its usage line records the outcome timeout

  @unit
  Scenario: A split call's timeout or throttle never stops short batches reaching the model
    Given a split call that timed out or was throttled
    When a batch of 8,000 characters or less arrives next
    Then the model is called for it
    And the next split batch goes to Presidio as breaker_open until two minutes have passed, then tries split calls again

  @unit
  Scenario: An aborted split call holds its slot until the model's own deadline has passed
    Given a split call aborted at its time cap
    Then the split slots count that call as in flight until 60 seconds after it started
    And free it at 60 seconds

  @unit
  Scenario: A spared text in a split span keeps its names and places but still masks an IBAN they overlap
    Given a split batch whose text is a model, provider or tool name, spared from name and place findings
    When a higher-scoring name finding overlaps an IBAN in one of its pieces
    Then every character of the IBAN is masked, shared ones included, and only the name's characters outside it stay

  @unit
  Scenario: A split span's usage line counts its calls
    Given a split batch the model answers in several calls
    Then one usage log line records the texts, the characters, the findings, the outcome ok and the number of split calls it was sent

  @unit
  Scenario: Splitting is on only where the model is a Lambda function and the organization's split flag is on
    Given an organization allowlisted for the PII redaction model
    When the model is reached over HTTP, or the organization's release_pii_redaction_model_split_enabled flag is off
    And a strict batch of 8,001 characters arrives
    Then Presidio answers it as today, with the outcome too_long
    When the flag cannot be read
    Then Presidio answers it as too_long, with one warning, and nothing is priced
    When the model is reached as a Lambda function and the flag is on
    Then the batch is split

  @unit
  Scenario: Split calls go to the model's one endpoint, each naming its context
    Given an organization allowlisted for the PII redaction model, with splitting on
    When a strict batch of 8,000 characters and one of 20,000 characters are analysed
    Then both reach the model through the one channel PII_REDACTION_MODEL_ENDPOINT configures
    And the short batch's call names the context single and each call of the long batch names the context split
    And no second model setting exists

  @unit
  Scenario: One setting names the model by Lambda ARN or by address
    Given PII_REDACTION_MODEL_ENDPOINT is set
    When its value starts with "arn:"
    Then the model is invoked as that Lambda function, in the region the ARN names
    And an ARN that is not a Lambda function ARN leaves the model unconfigured
    When its value is anything else
    Then the model is called over HTTP at that address

  @unit
  Scenario: Each PII redaction model call leaves one usage log line
    Given an organization allowlisted for the PII redaction model
    When a strict batch is routed to the model
    Then one log line records the organization, the project, the number of texts, the total characters, the spans found, the outcome and the duration
    And the outcome is ok, or the fallback reason such as timeout or error
    And the line holds no text, no finding value and no error message
    And each fallback is counted by reason, as is a routing that cannot be decided
    And a model call is counted, timed and its outcome recorded under its own labels, never Presidio's
    And an organization not allowlisted leaves no line
