Feature: Microsoft Copilot Studio conversations, read from Dataverse
  As a governance owner whose staff talk to Copilot Studio agents all day
  I want every conversation recorded against the person who had it
  So that I can answer "who asked our agents what, and what did they answer"

  The shipped Copilot source reads Microsoft's directory audit — the log of
  who was made an administrator and which app was granted consent. It records
  changes to the directory. It has never contained a conversation and no
  amount of tuning will make it contain one. The conversations live in
  Dataverse, in the transcript table the agent writes to itself.

  Two things about that table shape everything below. It stores a whole
  conversation as one blob of activities, most of which are internal
  bookkeeping rather than anything a person said. And it caps how much fits
  in a single row, so a long conversation is chopped into several rows that
  have to be stitched back together by the reader.

  Background:
    Given an ingestion source of type `copilot_studio_dataverse`
    And the source names a Power Platform environment
    And the source holds an application's own credentials, not a person's

  # --- What gets read, and from where ---

  @integration
  Scenario: Each turn in a conversation becomes its own trace, all sharing a thread
    Given a Copilot agent conversation with two questions and two answers
    When the puller runs
    Then one trace is recorded per turn, all sharing the same thread
    And each turn carries the question as the person typed it
    And each turn carries the answer as the agent gave it
    And every turn names the agent that answered

  @integration
  Scenario: Bookkeeping activities do not become turns
    Given a conversation whose stored activities are mostly internal events
    When the puller records it
    Then only the activities that carry something a person or agent said become turns
    And the internal events are counted but do not appear as turns
    # In the captured data this is 7 turns out of 212 activities. A reviewer
    # seeing 96% dropped should see it is deliberate, not a parsing failure.

  @integration
  Scenario: The conversation read never reaches beyond the environment
    Given the puller is configured and running
    And the source is not reading seat licences
    When a full pull completes
    Then every request went to the customer's Power Platform environment
    And no request went to Microsoft's directory service
    # Reading conversations needs Dataverse access and nothing else. The one
    # request that leaves the environment is the seat licence read, which is
    # separately consented on the tenant and can be switched off — see
    # specs/governance/pulled-seats.feature. A customer who declines the
    # directory permission still gets every conversation.

  @unit
  Scenario: A next page cannot move the token to another tenant
    Given the puller is reading from the customer's environment
    When a response offers a next page at a different Power Platform environment
    Then the puller stops rather than following it
    And the rows it already read are kept
    # Every tenant's environment is a Microsoft address, so "is this a
    # Dataverse host" is not the question worth asking of a URL the run is
    # about to send the access token to.

  # --- Stitching a chopped conversation back together ---

  @integration
  Scenario: A conversation stored across several rows is still one conversation
    Given a conversation long enough that Microsoft stored it as two rows
    When the puller runs
    Then every turn shares the same thread regardless of which row it came from
    And the turns appear in the order they were spoken
    # No real capture of a chopped conversation exists. This is built by hand
    # on purpose, and that fact belongs in the pull request description.

  @integration
  Scenario: Chopped pieces are ordered by their number, not their spelling
    Given a conversation stored as pieces numbered 2 and 10
    When the puller stitches them
    Then the piece numbered 2 comes before the piece numbered 10

  @integration
  Scenario: A conversation with a piece missing from the middle is marked incomplete
    Given a conversation whose stored pieces skip one in the middle
    When the puller records it
    Then the trace is recorded and marked as incomplete
    And it is not presented as a whole conversation

  @integration
  Scenario: A later piece arriving on its own is not mistaken for a missing one
    Given the opening piece of a conversation was read on an earlier run
    And only a later piece is available on this run
    When the puller records it
    Then the trace is not marked as incomplete
    # Pieces are written at different times, so a pull window can end between
    # them. Marking every later piece would fire the flag on the ordinary case
    # and leave it meaning nothing.

  # --- Identity: the same conversation pulled twice is the same conversation ---

  @integration
  Scenario: Re-pulling the same conversation does not duplicate it
    Given a conversation that has already been pulled
    When the puller runs again over the same window
    Then no duplicate traces appear for any turn in that conversation

  @integration
  Scenario: Identity survives Microsoft renumbering the underlying rows
    Given two stored rows describing the same conversation with different row identifiers
    When the puller records them
    Then both produce the same set of traces sharing the same thread
    # The row identifier names a storage chunk, not a conversation, so it is
    # never part of what identifies a conversation.

  @integration
  Scenario: The conversation's stored label is used whole, never taken apart
    Given one conversation whose stored label contains no underscore
    And another whose stored label contains several
    When the puller records both
    Then each is grouped correctly
    # The label happens to look like two identifiers joined together.
    # Microsoft documents that shape as something they observed, not something
    # they promise, so nothing here depends on it.

  @integration
  Scenario: Two sources reading the same environment stay separate
    Given two ingestion sources configured against the same environment
    When both pull the same conversation
    Then each source's traces are distinct from the other's
    # Otherwise the second source's conversations are silently swallowed by
    # the first source's, with nothing reporting a failure.

  @integration
  Scenario: A turn with no usable identifier is skipped, never invented
    Given a conversation containing an activity with no proper identifier
    When the puller records it
    Then that activity produces no turn
    And it is counted as skipped
    # A made-up identifier either collides with a different turn on the next
    # pull or moves when the text is edited. Both are worse than a gap.

  @integration
  Scenario: A turn the puller cannot date is skipped, never dated with the clock
    Given a conversation containing an activity with an unreadable timestamp
    When the puller records it
    Then that activity produces no turn
    And it is counted as skipped
    # Stamping it with the current time makes it win over the real record the
    # next time the same conversation is pulled.

  # --- Who said it ---

  @integration
  Scenario: A person's turn is attributed to that person
    Given a conversation containing a question from a signed-in person
    When the puller records it
    Then the turn names the person who asked

  @integration
  Scenario: The agent's own turns name no person
    Given a conversation containing an answer from the agent
    When the puller records it
    Then the turn names no person
    # Every activity, the agent's included, also carries a per-conversation
    # identifier that looks exactly like a person's. It is not one, it changes
    # between conversations, and it must never be used as one.

  # --- What the agent was running ---

  @unit
  Scenario: A conversation is named from the agent table, not from its own metadata
    Given a conversation whose stored metadata carries one agent id
    And whose agent lookup carries a different one
    When the puller puts a name on the conversation
    Then the name is the one belonging to the lookup
    And no name is attached when the lookup matches no agent
    # The two ids on a row genuinely differ. The one in the metadata is an
    # internal runtime value that joins to nothing, so reading it would not
    # fail loudly — it would attach a confident and wrong agent name.

  @unit
  Scenario: A run that cannot read the agent list still delivers its conversations
    Given the puller does not get the agent list, whether refused or answered empty
    When the puller runs
    Then the conversations are delivered without an agent name
    And the run does not report an error
    And an environment reporting no agents at all is called out
    # A name is a nicety; the conversations are the point. Reporting an error
    # would cost far more than the name: a run that reports one has its events
    # discarded and its cursor left where it was, so an environment that never
    # allows the agent list would be a source that never moves at all.
    #
    # A refusal is the loud case and the rarer one. A credential that reads the
    # agent table at the wrong depth is answered with success and no rows,
    # because the application user owns none of them, and that is identical to
    # a tenant with no agents. Hence the third step: without it the common
    # misconfiguration produces unnamed conversations and total silence.

  @integration
  Scenario: The trace names the product, never the model the agent was running
    Given the agent's settings have not changed since the conversation
    When the puller records the conversation
    Then every turn names the product "microsoft/copilot-studio" as its model
    And no attribute reports which model the agent was configured with
    # Written expecting a real model and revised on the evidence: the agent
    # record in the environment carries a name, a language, an authentication
    # mode and dates, and no model. There is nothing to read, so the trace
    # reports no model rather than a field no query can fill.
    #
    # Both halves are the requirement, and stating only the second would be
    # wrong: a product label IS emitted, on purpose. Cost enrichment runs on
    # every `llm` span and a routed conversation stays free only because that
    # label resolves to no price row — so "the trace says nothing about a
    # model" would license deleting the attribute that keeps it free.

  @integration
  Scenario: A conversation whose agent was edited afterwards is flagged
    Given the agent's settings were changed after the conversation happened
    When the puller records the conversation
    Then the trace marks that the agent has changed since
    # The transcript records what was said, never which configuration said it.
    # Anyone reading this trace as evidence of how the agent behaves needs to
    # know the agent is no longer the one that produced it.

  @integration
  Scenario: An unfinished tool call still shows
    Given a conversation where the agent started a tool call that never reported finishing
    When the puller records it
    Then the tool call appears, marked unfinished
    And the rest of the conversation is recorded normally

  @integration
  Scenario: Conversations from testing the agent are recorded and labelled
    Given a conversation held while designing the agent rather than using it
    When the puller runs
    Then the conversation is recorded
    And it is labelled as a test conversation
    # The person testing their agent is exactly the person who wants to see
    # the transcript, and a silent filter is harder to debug than a label.

  # --- Where the credentials are allowed to go ---

  @integration
  Scenario: An environment address that is not secure is refused at save time
    Given an admin entering an insecure environment address
    When they save the source
    Then the source is refused before it is stored

  @integration
  Scenario: An environment address Microsoft does not host is refused at save time
    Given an admin entering an address that is not a Power Platform environment
    When they save the source
    Then the source is refused before it is stored
    # Without this the server posts the customer's application secret to
    # whatever address was typed. Customers on their own domain cannot
    # self-serve and need a support ticket; that cost is accepted.

  @integration
  Scenario: A redirect never carries the credentials onward
    Given the configured address answers by redirecting elsewhere
    When the puller runs
    Then the puller does not follow the redirect
    And no credential reaches the redirect target
    # This holds for every polling source, not only this one.

  # --- What the environment costs, read from the Azure bill ---
  #
  # The transcript table says what was said and never what it cost. The bill
  # for the whole environment lives in Azure Cost Management, on the
  # subscription the environment runs in, and it is billed per day per meter
  # category rather than per conversation. So this is the environment's daily
  # bill carried alongside its conversations, not a price on any one of them.
  #
  # It is bundled into this source deliberately: it is the same customer, the
  # same credential and the same environment, and a second source to configure
  # would be a second thing to get wrong for one number.

  @unit
  Scenario: The daily bill is read as the currency the customer is billed in
    Given the subscription is billed in a currency other than dollars
    When the cost read runs
    Then each day is recorded in the billed currency
    And the dollar figure recorded is the one Microsoft itself published

  @unit
  Scenario: The day a bill arrives packed as digits is read as a calendar day
    Given Microsoft reports the day as a packed number rather than a date
    When the cost read runs
    Then each amount is filed under the calendar day those digits name

  @unit
  Scenario: A cost read that fails never costs the run its conversations
    Given the environment's conversations were read successfully
    When the cost read fails for any reason
    Then the conversations are still delivered
    And the run does not report an error
    And the run is not treated as having made no progress
    # This is the sharpest edge in the whole feature. The worker discards a
    # run that reports errors without moving its cursor — including the
    # transcripts it already read. A cost read that threw would therefore
    # throw away the conversations, which are the reason the source exists.

  @unit
  Scenario: Being asked to slow down leaves the window unpriced rather than priced at nothing
    Given Microsoft answers the cost read by asking us to retry later
    When the cost read runs
    Then no day in that window carries a cost figure
    And the run does not move its record of how far cost has been priced
    # Being throttled is normal operation here, not a fault: the very first
    # real call against a live subscription was throttled. Recording zero for
    # a day we were merely told to ask about later would be a confident wrong
    # number that nothing later corrects.

  @unit
  Scenario: The very first cost read ever being throttled leaves nothing behind
    Given the source has never successfully read cost
    When its first cost read is throttled
    Then the run records no cost at all
    And it still delivers its conversations
    # This is not the hypothetical case: it is what happened on the first real
    # request against a live subscription. A hold written assuming there is
    # already a priced-through point to hold at has no defined behaviour here.

  @unit
  Scenario: The bill is not asked about on every run
    Given a source whose bill was asked about a few minutes ago
    When the next run starts
    Then it makes no cost request
    And it attaches no cost figure to any day
    And the conversations are delivered as before
    # Azure publishes this bill once a day and refuses a caller that asks too
    # often. A source running every five minutes would ask 288 times a day
    # about a figure that moves once, and be throttled into never reading it
    # at all — which is exactly what a live subscription did.

  @unit
  Scenario: A source that has never asked about the bill asks on its first run
    Given a source that has never asked about cost
    When its first run starts
    Then it asks about the bill on that run
    # Someone who adds a source sees a figure on the first pull rather than
    # hours later.

  @unit
  Scenario: A throttled window is asked about again once the wait has passed
    Given a window being held because an earlier read was throttled
    When a run starts once the bill is due to be asked about again
    Then it asks about the bill on that run
    And it does not wait in place for the throttle to pass
    # A throttled read must not be the end of the matter. What separates this
    # from the run that skips is only elapsed time, and that is the whole
    # claim: the hold is a reason to wait, never a reason to stop.
    #
    # Deliberately says nothing about the shape of the window. The ask always
    # runs from the trailing week up to today whether the last read was
    # throttled, succeeded, or never happened, so no window a held source asks
    # about differs from one a healthy source asks about — a Then about the
    # span would read as though the hold caused it, and would hold just as
    # well with the hold removed.
    #
    # Nor does every unpriced day survive. A source that has never priced
    # anything has no mark to resume from, so its window is the trailing week
    # and the oldest day drops out at each midnight. That gap is real, is
    # tracked separately, and is not what this scenario claims.
    #
    # Waiting inside a run burns the run's whole deadline on a sleep and risks
    # it being killed holding the conversations it already read. The schedule
    # is the retry — but only on the runs that are due, because retrying a
    # throttled read every five minutes is what caused the throttling.

  @unit
  Scenario: The bill is asked about a handful of times a day
    Given a source pulling continuously through a whole day
    When the day is over
    Then the bill has been asked about more than once and far fewer than two dozen times
    # Both bounds earn their place. Asking once a day means a figure Azure
    # published this morning waits until tomorrow; asking on every run is the
    # live failure this gate exists to prevent, where a source read the bill
    # zero times in half an hour because Azure refused all of it.
    #
    # Says nothing about how often the source runs, because the gate cannot
    # see that: it reads elapsed time since the last ask and nothing else. A
    # source on a six-hourly schedule asks on every run and a daily one asks
    # once, and both are correct. Any claim here about a fraction of runs
    # would be false the moment someone types a legal cron.

  @unit
  Scenario: A window that cannot be read is asked about many times before it is given up on
    Given a window being held because an earlier read was throttled
    When the span before such a window is abandoned passes
    Then the bill has been asked about many times over within it
    # The two bounds have to be read together. An interval longer than the
    # give-up cap would abandon every held window before the next ask was ever
    # due, and a customer would never see a figure at all.

  @unit
  Scenario: A run that skips the bill neither holds the window nor abandons it
    Given a window being held because an earlier read was throttled
    When a run skips the cost read because the bill is not due yet
    Then the instant that window was first held at is unchanged
    And the source does not give up on the window on that run
    # A skip attempted nothing, so it must record nothing: it must not start a
    # hold on a source that has none, must not move the instant an existing
    # hold is anchored at, and must not be the run that abandons a window it
    # never asked about.

  @unit
  Scenario: A window held across several failed reads keeps the instant it was first held at
    Given a window already being held after a failed read
    When a later due read fails as well
    Then the window is still anchored at the instant it was first held at
    # Re-anchoring on each failure would push the give-up cap permanently out
    # of reach, and a window that can never be answered would pin the source
    # to one instant forever.

  @unit
  Scenario: A successful read records that the bill was asked about even when no figure changed
    Given a day that was already priced by an earlier run
    When a later run reads the bill again and finds the same figure
    Then the source still records that it asked on this run
    # The record of asking is what the gate reads. A run that asked but did
    # not write that down leaves the source due again minutes later, which is
    # the every-five-minutes loop this whole section exists to stop.

  @unit
  Scenario: A record of asking that lies in the future does not stop the bill being read
    Given a stored position whose record of the last ask is in the future
    When the puller runs
    Then the bill is asked about on that run
    # A clock that moved backwards, or a position rewound by hand to re-sweep
    # a period, must not jam the gate shut until real time catches up.

  @unit
  Scenario: A position carrying no record of when the bill was last asked about reads it at once
    Given a stored position written before the timing of the cost read was recorded
    When the puller runs
    Then the bill is asked about on that run
    # Positions are read back on every scheduled run. A source configured
    # before this existed must start asking again, not sit waiting on a time
    # it never recorded.

  @unit
  Scenario: A window held for too long is given up rather than held forever
    Given a window that has been held unpriced for longer than the cap
    When the next run that is due to ask about the bill starts
    Then the source moves past that window
    And it keeps reading conversations and later days
    # Holding is right for a bill that is merely late. A window that can never
    # be answered would otherwise pin the source to one instant permanently.

  @unit
  Scenario: A source that names no subscription reads no cost at all
    Given the source names no Azure subscription
    When the puller runs
    Then no cost request is made
    And the conversations are delivered as before
    # The cost read is opt-in. A customer who only wants transcripts must not
    # have a second permission grant forced on them to get them.

  @unit
  Scenario: The first cost read asks about a window that covers the settling days
    Given a source that has never read cost before
    When its first cost read runs
    Then it asks about a window ending today
    And that window reaches back far enough to cover days still settling
    # Today's figures are partial by construction — the captured probe shows
    # today's load balancer at 0.375 against 0.60 on every finished day. A
    # read that only ever asked about new days would record every day at its
    # partial figure and never correct one.

  @unit
  Scenario: A day already recorded is re-read and its figure replaced, not added to
    Given a day was recorded while it was still running
    When the same day is read again after it finished
    Then both reads describe the same day under the same identity
    And the finished figure replaces the partial one rather than adding to it
    # The replacement itself is the summarizing step's job and already works.
    # What is new and easy to get wrong is here: the two reads must produce
    # the SAME identity for the same day and meter, or the correction lands
    # beside the figure it was meant to correct and the day doubles.

  @unit
  Scenario: A re-read day the bill has not landed for emits no figure at all
    Given a day inside the re-read window that Microsoft returns no row for
    When the cost read runs
    Then the run attaches no cost to that day
    # Not "records a zero that is later replaced": a zero emitted for a day
    # already recorded at a real figure is a correction downward to nothing,
    # and the summarizing step would honour it. The absence has to survive as
    # an absence all the way out of the puller.

  @unit
  Scenario: A cost reply spread over several pages is read whole
    Given Microsoft answers the cost read with more rows than one page holds
    When the cost read runs
    Then the days on every page are recorded
    # The captured probe fits in one page and still carries the field that
    # offers a second. A reader that stops at the first page under-reports
    # the bill and does so silently.

  @unit
  Scenario: A cursor written before cost existed is still read
    Given a source whose stored position was written before cost was ever read
    When the puller runs
    Then the position is read as it always was
    And the source starts reading cost from scratch rather than failing
    # Positions are persisted and read back on every scheduled run. A shape
    # change the old value cannot survive stalls every already-configured
    # source at once.

  # --- One source, several reads: they do not hold each other hostage ---
  # The source reads conversations from the environment, the bill from Azure,
  # and seat licences from the tenant — three reads under three separate
  # sign-ins. A customer whose environment address is wrong is still being
  # billed, so the reads that CAN succeed must land while the one that cannot
  # keeps failing loudly. This replaces the earlier rule that a conversation
  # failure discarded the cost read along with it.

  @unit
  Scenario: The bill is still recorded when the environment cannot be reached
    Given a source that reads conversations and the provider's bill
    And the conversation read cannot sign in to the environment
    When the source runs
    Then the day's bill is delivered and its priced-through mark advances
    And the run still reports the conversation failure
    And the conversation position does not move
    # The bill and the licences are read before the environment sign-in is
    # attempted, and the conversation failure no longer abandons the run's
    # result. The advanced cost mark is what lets the framework keep the
    # delivered figures while still counting the failure.

  @unit
  Scenario: A conversation failure with no new bill still fails the run
    Given the bill is already priced through today
    And the bill is not due to be asked about again yet
    And the seat licences are already reported through today
    And the conversation read cannot sign in to the environment
    When the source runs
    Then the run fails and the same window is retried
    # The second and third Givens are both load-bearing, and each fails this
    # scenario on its own. A run that is due to ask about the bill records
    # that it asked, and that record counts as the position moving even when
    # the figure is unchanged — so on those few runs a day this scenario does
    # not apply and the failure is reported the ordinary way. The vast
    # majority of runs ask nothing, and those are the ones that need the
    # position to stay still.
    #
    # The third Given is the same story a day later: one minute after UTC
    # midnight the seat mark rolls to the new day, that roll counts as
    # movement, and this same dead environment does not fail its run. Reported
    # through today is therefore a real precondition, not scene-setting. It is
    # also the one Given the bound test cannot show, because that test file
    # reads no licences at all — the seat lane's own tests carry it.
    #
    # The cost and seat marks only move once a day. If their daily advance
    # stood in for conversation progress on every run, a dead environment
    # would look like steady progress. Failing the runs in between is what
    # keeps the failure visible. The cost restatements those failed runs
    # produced are discarded with them; the amendment lands at the next
    # day-roll, at most a day late.

  @unit
  Scenario: The conversation window is retried without losing the priced bill
    Given a run that priced the bill and then failed to read conversations
    When the next run succeeds
    Then the conversation window resumes from where the failed run started
    And the bill's priced-through mark stays on that same day
    # The trailing week is still re-read and restated in place on every run —
    # that is how late-settling days get corrected. What holds still within a
    # day is the mark, not the reading.

  # --- Retiring the source that never worked ---

  @integration
  Scenario: The old Copilot source can no longer be chosen
    Given an admin adding a new ingestion source
    When they open the source picker
    Then the old Copilot audit source is not offered

  @integration
  Scenario: Sources already configured on the old type still display
    Given an ingestion source already configured on the old Copilot type
    When an admin opens the inventory
    Then that source still shows its name rather than a blank

  # --- Not in scope, so nobody goes looking for it ---

  # No price on any individual conversation. The bill above is the whole
  # environment's daily cost per meter category, which is the only granularity
  # Azure publishes it at — nothing here divides it across conversations, and
  # a share worked out from a daily total would be invention rather than
  # measurement. No charts. No conversation history older than thirty days —
  # Microsoft deletes it on a schedule before then. Attribution shows the raw
  # account identifier until the identity work lands separately.
