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
  Scenario: A conversation becomes one trace carrying what was said
    Given a Copilot agent conversation with two questions and two answers
    When the puller runs
    Then one trace is recorded for that conversation
    And the trace carries each question as the person typed it
    And the trace carries each answer as the agent gave it
    And the trace names the agent that answered

  @integration
  Scenario: Bookkeeping activities do not become turns
    Given a conversation whose stored activities are mostly internal events
    When the puller records it
    Then only the activities that carry something a person or agent said become turns
    And the internal events are counted but do not appear as turns
    # In the captured data this is 7 turns out of 212 activities. A reviewer
    # seeing 96% dropped should see it is deliberate, not a parsing failure.

  @integration
  Scenario: The puller never reaches beyond the customer's environment
    Given the puller is configured and running
    When a full pull completes
    Then every request went to the customer's Power Platform environment
    And no request went to Microsoft's directory service
    # The customer therefore consents to Dataverse access only. No directory
    # permission is requested, and none is needed.

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
    Then one trace is recorded, not two
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
    Then no second trace appears for that conversation

  @integration
  Scenario: Identity survives Microsoft renumbering the underlying rows
    Given two stored rows describing the same conversation with different row identifiers
    When the puller records them
    Then both produce the same trace
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

  @integration
  Scenario: The agent's model is recorded when it can be trusted
    Given the agent's settings have not changed since the conversation
    When the puller records the conversation
    Then the trace claims nothing about which model answered
    # Written expecting a model and revised on the evidence: the agent record
    # in the environment carries a name, a language, an authentication mode
    # and dates, and no model. There is nothing to read, so the trace says
    # nothing rather than reporting a field no query can fill.

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

  # No money figures of any kind. No charts. No conversation history older
  # than thirty days — Microsoft deletes it on a schedule before then.
  # Attribution shows the raw account identifier until the identity work
  # lands separately.
