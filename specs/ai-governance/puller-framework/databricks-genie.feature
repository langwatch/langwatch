Feature: Databricks AI/BI Genie puller
  As a governance owner whose analysts query the warehouse in natural language
  I want every Genie question, and the SQL Genie generated from it, recorded
  against the person who asked
  So that I can answer "who asked what of our data, and what ran against it"

  Genie charges nothing per message. The warehouse compute that answers the
  question does, and that spend is billed to the customer whether or not anyone
  attributes it. So a source that names a warehouse gets each question's share
  of that compute; a source that names none carries a cost of zero and must
  never invent one.

  Background:
    Given an IngestionSource of type `databricks_genie`
    And a workspace token in `pullConfig.credentials.token`

  @integration
  Scenario: One record per question, carrying the question and the SQL
    Given a Genie space with a conversation containing one message
    And the message generated a SQL query against the warehouse
    When the puller runs
    Then one activity record is written for that message
    And the record carries the question as the user typed it
    And the record carries the generated SQL
    And the record names the space the question was asked in

  @integration
  Scenario: Every user's activity is captured, not just the caller's
    Given the workspace has conversations started by several different people
    When the puller lists conversations
    Then it asks for all users' conversations
    And the records cover every person who asked a question
    # Without this the workspace's activity silently collapses to the service
    # account's own, and nothing anywhere reports a failure.

  @integration
  Scenario: A question costs nothing when no warehouse is named
    Given a Genie source configured without a warehouse
    When the puller records a message
    Then the recorded cost is zero
    And the puller does not ask the workspace about billing
    # Genie itself bills nothing per message. Naming the warehouse is what
    # opts a source into attributing the compute behind the question.

  Rule: A named warehouse turns each question's share of compute into cost

    Databricks does not price a Genie question. It bills the warehouse for the
    hours it was awake, and reports the SQL each question ran. The share is
    ours to compute, so every scenario here is about not overstating it.

    @integration
    Scenario: The compute behind a question is charged to the person who asked
      Given a Genie source that names the warehouse answering its questions
      And a message whose generated SQL ran on that warehouse
      When the puller records it
      Then the record carries a cost above zero
      And the cost is attributed to the person who asked the question
      And the cost is marked an estimate

    @integration
    Scenario: An hour's compute is split across the questions that used it
      Given a warehouse billed for one hour of compute
      And two questions ran in that hour, one taking twice as long as the other
      When the puller records them
      Then the longer question carries twice the cost of the shorter
      And together they carry no more than the hour's billed compute
      # The warehouse is billed for being awake, not per query. Anything that
      # hands every query the whole hour reports the bill once per question.

    @integration
    Scenario: Other traffic on the warehouse keeps its share of the bill
      Given a warehouse billed for one hour of compute
      And half that hour was spent on queries no Genie question asked for
      When the puller prices the Genie questions in that hour
      Then they carry at most half the hour's billed compute
      And the rest is left unattributed
      # Dividing the hour across Genie's queries alone hands Genie the whole
      # warehouse bill, including the dashboards and jobs sharing it.

    @unit @integration
    Scenario: Traffic that began before the hour keeps its share of the bill
      Given a query that started in the hour before and ran on into this one
      And a short question asked inside this hour
      When the puller prices this hour
      Then the query that ran in from before carries part of this hour's bill
      And the short question carries only its own share of the time worked
      # The bill is for the hour the work ran in, not the hour it was started
      # in. Counting a straddling query only against the hour it began in
      # leaves this hour's bill divided among whatever happened to start in it,
      # so a one-second question can end up carrying an entire hour of compute.

    @integration
    Scenario: The puller's own billing query is not charged to a question
      Given the puller asks the warehouse for its billing
      When that query appears in the warehouse's own history
      Then no question is charged for it

    @integration
    Scenario: Genie's own free usage is never charged
      Given the workspace bills a free-usage line for Genie alongside the warehouse
      When the puller prices a question
      Then only the warehouse compute is counted
      And the free-usage line adds nothing

    @integration
    Scenario: A question whose SQL has not reached the billing tables yet
      Given a message whose generated SQL is too recent to appear in query history
      When the puller records it
      Then the record carries a cost of zero
      And the message is recorded for visibility regardless

    @integration
    Scenario: Cost that arrives late corrects the record rather than adding one
      Given a message first recorded before its compute was billed
      When a later run reads it again and the compute is now billed
      Then the message still appears once
      And the cost it carries is the billed one
      # Same question, same coordinates, so the same record. A second row here
      # would double the reported spend of every question near the boundary.

    @integration
    Scenario: A source that prices its questions keeps looking back far enough
      Given a Genie source that names a warehouse
      When a run finishes
      Then the next run still reads the questions whose compute could have been billed since
      # Databricks publishes a query's compute well after the query. A source
      # that stops looking at a question five minutes after it was asked can
      # never learn what it cost, and every question would sit at zero forever.

    @integration
    Scenario: A source that prices nothing does not widen its window
      Given a Genie source configured without a warehouse
      When a run finishes
      Then the next run reads only the questions asked since the last one
      # The look-back is bought with requests against the workspace. Only a
      # source that has something to learn from it should pay.

    @integration
    Scenario: A question that ran no SQL is charged nothing
      Given a message Genie answered without running a query
      When the puller records it
      Then the recorded cost is zero

    @integration
    Scenario: A priced question calls its figure an estimate
      Given a workspace whose account may have a discount off the published rate
      When the puller prices a question
      Then the figure is marked an estimate
      # The account's negotiated discount is on no table this token can read, so
      # the figure can only ever come from the published rate. Saying so is the
      # whole difference between a useful number and one somebody reconciles
      # against a bill and finds wrong.
      #
      # That the arithmetic reaches for the published rate rather than any other
      # price lives in the SQL, and no test executes the SQL — replacing the
      # whole statement with nonsense leaves every test green. This scenario
      # therefore claims only what is observed: the label. See langwatch-saas#1116.

    @integration
    Scenario: A cost answer that was cut short prices nothing
      Given a warehouse busy enough to fill the cost query's row limit
      When the puller reads the cost
      Then no question is priced from that answer
      # Which statements the answer left out is exactly what it cannot tell us.
      # Pricing the ones that arrived would put a confident zero on the rest.

    @integration
    Scenario: A window whose cost was cut short is asked about again
      Given a cost answer that comes back cut short
      When the puller reads the cost
      Then that period is read again on the next run
      And a question asked on its very first instant is read again too
      # The second line is not the first one restated. Within the settling
      # look-back a question is re-read regardless of the watermark, so a
      # scenario phrased only about the watermark's position is either false or
      # passes on the defect it exists to catch. The instant that decides it is
      # the period's first: the two windows are half-open in the same direction,
      # so a question asked exactly there is inside the unpriced period but
      # excluded by a watermark standing on it — recorded at zero once, then
      # never looked at again.
      #
      # The watermark is monotonic —
      # a period below it is already re-read by the settling look-back, and a
      # watermark that could move backwards would widen the re-read window every
      # time billing hiccuped, without bound.

    @integration
    Scenario: A period that can never be priced is eventually given up on
      # The hold above is a bet that the bill is late. A day with more statements
      # than one reply can carry is refused identically every run, so the bet
      # never pays and an unbounded hold pins the source to one instant forever.
      Given a period the warehouse has refused to price for longer than the hold allows
      When the puller reads the cost
      Then the watermark moves on without it
      And those questions keep the zero they already carry
      # Refusing a partial answer is only half the job. A first sweep reads
      # thirty days, and later runs re-read only the settling window, so a
      # watermark that moved past those thirty days would make their zeros the
      # permanent answer — the same undercount the refusal was meant to prevent,
      # just spread evenly. The cost is a re-read of a period already recorded,
      # and re-emitting a question replaces its ledger row rather than adding
      # one, so the real figure lands as soon as the bill does.
      #
      # The window is read a week at a time so that holding it is recoverable
      # rather than a stall: a week busy enough to be refused does not stop the
      # ones priced before it from keeping their cost, and the refused week is
      # re-asked in days rather than surrendered whole.
      #
      # Held when the answer was CUT SHORT, and when it RAN OUT OF TIME. Billing
      # refusing the question outright is not held: a narrower question would be
      # refused the same way, and holding would stall a workspace that never
      # granted the billing tables, with no way out but turning the feature off.
      #
      # Running out of time is not refusing. The two arrive as the same shape —
      # an answer that is not a success — and reading them as one was worth a
      # month of silent zeroes on a workspace whose billing tables are merely
      # slow. The scenarios below hold the two apart.

    @integration
    Scenario: A cost answer cancelled for taking too long is asked about again
      Given a period whose billing answer is cancelled for exceeding its time limit
      When the puller reads the cost
      Then that period is read again on the next run
      And a question asked on its very first instant is read again too
      # The second line is the one with teeth, for the reason the cut-short
      # scenario above gives: inside the settling look-back a period is re-read
      # whatever the watermark says, so an assertion about re-reading alone goes
      # green with the watermark left standing exactly where the defect puts it.
      #
      # A cancelled answer and a refused one arrive identically: neither says
      # SUCCEEDED. Only one of them is worth asking again. Reading both as
      # "cannot be answered" moves the watermark past a period nothing priced,
      # and later runs look only at the settling window — so the zero those
      # questions carry becomes the final answer to a question billing was
      # merely slow to answer.

    @integration
    Scenario: Billing refusing the question outright is still not held
      Given a workspace that will not let this credential read its billing
      When the puller reads the cost
      Then the watermark moves on without it
      And the questions are still recorded
      # The counterpart to the scenario above, and the reason that one is phrased
      # about time rather than about failure. A credential without the billing
      # grant is refused identically forever; holding for it would stall the
      # source with no way out but turning the feature off.
      #
      # Deliberately silent on how the refusal arrives. A missing grant comes
      # back as a successful request carrying a failed statement, while a revoked
      # token comes back as the request itself being rejected — two different
      # paths that must reach the same answer, and a scenario naming either one
      # would leave the other free to hold forever.

    @integration
    Scenario: A period the answer cannot carry whole is re-asked in smaller pieces
      Given a period with more statements than one billing answer can carry
      When the puller reads the cost
      Then the questions in the parts of it that can be priced still get a cost
      And only the part that cannot be priced is left for a later run
      # Surrendering the whole period costs every question in it its cost figure,
      # including the days that would have answered on their own. Asked only
      # after the whole period was refused, so a healthy workspace never pays for
      # the extra questions.

    @integration
    Scenario: Pricing a month of questions fits in the time a run is given
      Given a source whose first run looks back a month
      When that run prices its questions
      Then it asks the warehouse for billing few enough times to finish in one run
      And no part of the month is left unpriced for want of time
      # Phrased as a count of questions asked, not as elapsed time, and that is
      # the load-bearing choice. Nothing that exercises this waits on a real
      # warehouse, so an answer that arrives instantly makes any number of
      # questions fit — a scenario about the clock goes green on the very defect
      # it is here for. The count is what overran: the look-back and the size of
      # one billing question decide it, and a month asked a day at a time needs
      # more time than a run is given.
      #
      # A run that overruns does not merely go unpriced. It is killed holding the
      # questions the sweep had already read, so it discards them and keeps its
      # cursor, and the next run stalls in exactly the same place.

    @integration
    Scenario: Compute the workspace prices in another currency is not converted
      Given the warehouse's billed compute is priced in a currency other than USD
      When the puller prices a question
      Then no cost is recorded for it
      And the run reports why
      # A guessed conversion rate is a number nobody can reconcile against the
      # invoice, and it would look exactly like a real one.

    @integration
    Scenario: Compute the workspace has no published price for is not guessed
      Given the warehouse's billed compute has no published price
      When the puller prices a question
      Then no cost is recorded for it
      And the message is still recorded for visibility

    @integration
    Scenario: A billing outage never rewrites a cost that was already worked out
      Given a question whose compute has already been priced
      When a later run reads it again and the workspace refuses the billing query
      Then the question keeps the cost it was already given
      # The re-read exists only to learn a cost. A run that learned none has
      # nothing to say about this question, and saying "zero" would erase the
      # answer an earlier run got right — a few minutes of billing trouble would
      # quietly wipe the spend it could not confirm.

    @integration
    Scenario: Billing answered in a shape we did not ask for is not priced from
      Given the workspace answers the billing question with different columns
      When the puller reads the answer
      Then no cost is recorded from it
      And the questions are still recorded
      # Every value in that answer is text, so the wrong columns parse just as
      # cleanly as the right ones and price each question off whichever number
      # happened to land in that position.

    @integration
    Scenario: A question's hour is priced whole or not at all
      Given a run whose window begins part-way through an hour
      When the puller prices the questions asked in that hour
      Then that hour's compute is either counted in full or not counted
      # The bill is published per hour and the queries are recorded per hour. A
      # window cutting an hour in half keeps its queries and loses its bill, so
      # every question in it prices at nothing while looking properly priced.

    @integration
    Scenario: A billing outage does not discard the questions
      Given the workspace refuses the billing query
      When the puller runs
      Then the messages are still recorded
      And the failure is reported
      And the watermark stays where it was
      # Visibility is the floor. Losing a run's activity because its cost could
      # not be worked out trades the thing that always works for the one that
      # sometimes does.

    @integration
    Scenario: A run too short to price keeps the questions it read
      Given a run with less time left than a billing query is allowed to take
      When the puller reaches the billing read
      Then the billing query is never sent
      And the messages are still recorded
      And the watermark stays where it was
      # The worker kills a run that overruns its deadline and discards
      # everything the sweep read, so the billing query's own graceful failure
      # never gets to happen. A read that cannot finish in the time left has to
      # be declined before it starts, not abandoned partway.

    @integration
    Scenario: A fraction of a cent survives the record
      Given a question whose share of compute is a small fraction of a cent
      When the puller records it
      Then the cost is kept at full precision
      And it is not rounded to zero
      # A per-question share of an hourly bill is routinely sub-cent. Rounding
      # at the record makes a busy workspace report nothing at all.

    @unit
    Scenario: A question seen before its bill has landed is held, not zeroed
      Given a question whose hour has no billing row yet
      When the puller allocates warehouse cost
      Then the question is neither priced nor skipped
      And the puller holds its place to ask again later
      # Billing lags query history by hours. A missing row is a bill in
      # flight, not a free question — recording $0 now would overwrite real
      # spend the moment it lands, because a re-read that already answered
      # cannot answer again.

    @unit
    Scenario: A statement that priced on any line is not held for an unbilled one
      Given a statement with one billed line and one line not yet billed
      When the puller allocates warehouse cost
      Then the statement carries the billed line's cost
      And it is not held waiting on the unbilled one
      # The priced line wins. Holding an already-priced statement would stall
      # the watermark on every hour where two SKUs bill at different speeds.

    @unit
    Scenario: A statement is held when an hour it ran through has no bill yet
      Given a query that ran through two hours
      And only the first of those hours has been billed
      When the puller allocates warehouse cost
      Then the query is held rather than recorded at the first hour's cost
      # A query spanning two hours is only fully priced once both hours have
      # billed. Recording it on the first hour alone understates it, and the
      # record cannot be revised later, so the unbilled hour has to hold it —
      # the same rule as an entirely unbilled question, applied per hour.

    @unit
    Scenario: The billing query only ever runs on the configured workspace
      Given a Genie source that names a warehouse
      When the puller asks for billing
      Then the question is sent to the workspace address on the source
      # Same secret, same reasoning as every other call this adapter makes: the
      # address on the source decides where the token goes.

    @unit
    Scenario: A question is still priced after the provider renames its client label
      Given a Genie statement whose history row names its Genie space
      But the row's client label is not the one the puller knows
      When the puller asks for billing
      Then the statement is still counted as Genie work
      # The label is a display string the provider can rename or localize at
      # will; the space id is structural. Either one alone is a cliff — gating
      # on the union means no single provider change can silently shrink the
      # set of statements we price to zero.

    @unit
    Scenario: A question is still priced when its history row names no space
      Given a Genie statement whose history row carries the known client label
      But names no Genie space
      When the puller asks for billing
      Then the statement is still counted as Genie work
      # The other half of the union: a runtime that stops populating the space
      # id must not silently drop cost we capture today.

    @integration
    Scenario: A priced question carries the numbers its share was worked out from
      Given a warehouse billed for an hour in which questions ran for a small
        fraction of it
      When the puller records a question from that hour
      Then the record carries the hour's bill and the hour's total executed time
      And it claims no busy percentage
      # An hourly bill charges for being awake, so a lone question on a mostly
      # idle warehouse absorbs the idle time. The share is correct — it never
      # exceeds the real bill — but "$4 for a 5-second question" needs its
      # ingredients on the record to read as anything but a bug. RAW
      # ingredients, deliberately: a busy RATIO was designed and refuted —
      # executed time sums over concurrent statements (two parallel full-hour
      # queries read as 200% busy), and a serverless warehouse that auto-stops
      # mid-hour makes a clock-hour denominator invert the story (two minutes
      # flat-out reads as 97% idle when the billed idle was zero). True
      # utilization needs billed uptime, which no table the puller reads
      # carries — so the record says what was measured and claims nothing more.

    @unit
    Scenario: The hour's context never changes which record a correction lands on
      Given a question priced with one hour context
      And a later re-read of the same hour computes a different one
      When the correction is recorded
      Then it replaces the earlier record rather than adding one
      # The context is derived, so late-arriving statements change it. Derived
      # values stay out of the record's identity: keyed, a correction would
      # mint a new record and the ledger would count the question twice.

  @integration
  Scenario: Identity resolves to the directory's object id when it has one
    Given the author's directory entry has an external object id
    When the puller resolves the author
    Then the record is keyed on that object id

  @integration
  Scenario: Identity falls back to the login when there is no object id
    Given the author's directory entry has no external object id
    When the puller resolves the author
    Then the record is keyed on the author's login
    And the record is still attributed to that person

  @integration
  Scenario: An author the directory no longer has is looked up once
    Given a message whose author has been deleted from the directory
    When the puller reads many messages by that author
    Then the directory is asked about that author only once
    And every message is still recorded, unattributed

  @integration
  Scenario: A directory outage does not strip authors off the rest of the run
    Given the directory fails temporarily while resolving one author
    When the puller reads a later message by the same author
    Then it asks the directory again rather than reusing the failure

  @integration
  Scenario: Every page of every list is read
    Given a space whose conversations span more than one page
    When the puller runs
    Then messages from every page are recorded

  @integration
  Scenario: Pagination that does not advance is refused
    Given a list endpoint that returns the same page token it was given
    When the puller reads it
    Then the run reports a failure
    And the watermark does not move
    # Following it would burn the whole run re-reading one page and then look
    # indistinguishable from a workspace that is simply large.

  @integration
  Scenario: One unreadable space does not discard the others
    Given a workspace with several spaces
    And the token cannot read one of them
    When the puller runs
    Then the messages from the readable spaces are still recorded
    And the failure is reported

  @integration
  Scenario: The watermark never moves past data that was not fetched
    Given a sweep that could not read one space
    When the run finishes
    Then the watermark stays where it was
    And the next run reads that space's history again

  @integration
  Scenario: A sweep cut short by its budget resumes where it stopped
    Given a workspace with more spaces than one run may read
    When the run reaches its request budget
    Then the records it already read are kept
    And the watermark stays where it was
    And the next run starts at the space it stopped on

  @integration
  Scenario: Activity during a sweep is caught by the next one
    Given a sweep that reads several spaces in turn
    And someone asks a question in an already-read space while it runs
    When the next run happens
    Then that question is recorded
    # The watermark is anchored to when the sweep BEGAN, not to the newest
    # message it happened to see.

  @integration
  Scenario: A re-read message is recorded once
    Given a message that falls inside two consecutive runs' windows
    When both runs record it
    Then it appears once in the activity records
    And it moves no money

  @integration
  Scenario: The workspace token is never stored in plain text
    Given an admin configures a Genie source through the governance UI
    When the source is saved
    Then the token is held encrypted
    And the token is not readable from the source's configuration

  @unit
  Scenario: The token may only be sent to a Databricks workspace
    Given a Genie source whose workspace address is not a Databricks one
    When someone saves it
    Then the save is refused
    And the reason names the addresses that are allowed
    # The worker attaches the stored token to every request it sends to this
    # address, so whoever sets it decides where the secret goes. Checked when
    # it is saved, because by the time a run uses it the person is long gone.

  @unit
  Scenario: A secret cannot be kept while the destination is changed
    Given a source that already holds a workspace token
    When someone saves it with the stored secret sent back verbatim
    Then the save is refused
    And the stored secret is unchanged
    # Otherwise a caller who cannot read the secret could still keep it while
    # pointing the source at an address of their choosing.

  @unit
  Scenario: Saving an unrelated change keeps the secret and the rotation window
    Given a source that already holds a workspace token
    And a rotation of its ingest secret is still inside its grace window
    When someone renames the source without re-entering the token
    Then the stored token is unchanged
    And the rotation grace window is unchanged
    # A client is never shown either of them, so it cannot send them back, and
    # absent has to mean unchanged rather than cleared.

  Rule: A source can sign in for itself, so a schedule outlives a pasted token

    A Databricks token expires about an hour after it is issued. A source
    configured by pasting one works when the admin saves it and is dead by the
    next morning, with nothing on the source to say why. Given a service
    principal's client id and secret instead, the source signs in at the start
    of every run and the schedule keeps running unattended.

    @integration
    Scenario: A source given a client id and secret signs in for itself
      Given a Genie source holding a service principal's client id and secret
      And no pasted workspace token
      When a run starts
      Then the source asks the workspace for a token
      And the run records the workspace's Genie activity

    @integration
    Scenario: A pasted token is still honoured
      Given a Genie source holding a pasted workspace token
      When a run starts
      Then the source does not ask the workspace for a token
      And the run records the workspace's Genie activity
      # Sources configured before this existed must keep working untouched.

    @integration
    Scenario: A pasted token wins over a client secret
      Given a Genie source holding both a pasted token and a client secret
      When a run starts
      Then the source does not ask the workspace for a token
      # Someone who pastes a token into a source that already had a secret is
      # rotating by hand, usually because the secret stopped working. Silently
      # preferring the secret would ignore the thing they just did and leave
      # them staring at a source that still fails.

    @integration
    Scenario: A source with no way to sign in says so
      Given a Genie source holding neither a pasted token nor a client secret
      When a run starts
      Then the run fails
      And the reason names what it needs to be given

    @integration
    Scenario: Credentials the workspace rejects fail the run rather than emptying it
      Given a Genie source whose client secret the workspace refuses
      When a run starts
      Then the run fails
      And the reason says signing in was refused
      # A rejected sign-in that returned no records would look identical to a
      # workspace where nobody asked Genie anything, and the source would sit
      # green and silent.

    @integration
    Scenario: A sign-in answered with no token fails the run
      Given a Genie source whose workspace answers the sign-in without a token
      When a run starts
      Then the run fails
      # A proxy or captive portal answering 200 with something that is not a
      # token must not be carried forward as one, which would fail later as an
      # unauthorised Genie call and read as a permissions problem.

    @integration
    Scenario: A sign-in that hangs does not consume the whole run
      Given a Genie source whose workspace never answers the sign-in
      When a run starts
      Then the sign-in is abandoned before the run's own deadline
      And the run fails
      # The job has five minutes for everything. A sign-in with no bound of its
      # own would spend all of it and report nothing.

    @integration
    Scenario: Signing in happens once a run, not once a request
      Given a Genie source holding a service principal's client id and secret
      And a run that reads several pages across several spaces
      When the run finishes
      Then the workspace was asked for a token exactly once

    @integration
    Scenario: The client secret is never stored in plain text
      Given an admin configures a Genie source with a client id and secret
      When the source is saved
      Then the secret is held encrypted
      And the secret is not readable from the source's configuration

    @integration
    Scenario: A refused sign-in does not put the secret in the reason
      Given a Genie source whose client secret the workspace refuses
      When a run starts
      Then the recorded reason does not contain the secret
      # The reason is logged and surfaced on the source, so anything it carries
      # is readable by people who were never given the credential.
