Feature: A run records who started it
  As a person reading a run somebody else started
  I want the run to name the person who started it
  So that I can ask them what they changed instead of guessing

  Background: what the actor is, and where it lives.
    A run records the person who started it, not the machine that ran it. The
    record is two fields in the reserved `langwatch` namespace of the run
    metadata, beside the scenario version: `actorId`, the platform user id,
    and `actorLabel`, the surface that user acted through. This is the pair
    a scenario version already stores as `authorId` and `authorLabel`, so the
    two records read the same way.

    The id is what makes the record stable. A person can rename themselves,
    and a run started last month must still point at them, so the run stores
    no name.

    The namespace is passthrough into the stored run metadata, so no column
    and no migration are needed for it.

    Three ways to start a run, and only two of them can name a person:

    - the app, where a signed-in user pressed Run: `user`;
    - the CLI or the REST API with a user-bound key: `cli` or `api`, with
      the user the key belongs to;
    - a project key that belongs to no user, and the SDK pushing its own run
      events: no person, so no actor at all.

    A run with no actor records nothing. It never records a placeholder, and
    no reader is ever shown one.

  # --- Stamping ---

  @integration
  Scenario: A suite run started in the app records the person who started it
    Given a signed-in person opens a run plan
    When they start a run of it
    Then every run of that batch records their user id
    And every run of that batch records the surface "user"

  @unit
  Scenario: A one-off run started in the app records the person who started it
    Given a signed-in person opens a scenario
    When they run it against a target
    Then the run records their user id
    And the run records the surface "user"

  @unit
  Scenario: A run started by no person records no actor
    Given a run started with no actor
    When the run is queued
    Then the queued run records no user id
    And the queued run records no surface

  @integration
  Scenario: A REST run with a key that belongs to no person records no actor
    Given a project key that belongs to no person
    When it starts a suite run over REST
    Then no run of that batch records a user id
    And no run of that batch records a surface

  @unit
  Scenario: A user-bound key records the person it belongs to, through the surface it declared
    Given a key that belongs to a person
    When the CLI declares itself on the request
    Then the actor is that person, through the CLI
    And a request that declares nothing is that person, through the API
    And a request with no person behind it names no actor

  @unit
  Scenario: The actor sits beside the scenario version, not at the top level
    Given a run started by a signed-in person
    When the queued metadata is read
    Then the actor reads inside the reserved namespace
    And no actor field reads at the top level of the metadata

  # --- Reading it back ---

  @integration
  Scenario: The batch history reports who started each batch
    Given a batch whose runs record a user id and the surface "user"
    When the batch history of that run set is read
    Then the batch reports that user id and that surface

  @integration
  Scenario: The summary of one batch reports who started it
    Given a batch whose runs record a user id and the surface "user"
    When the summary of that one batch is read
    Then the summary reports that user id and that surface

  @integration
  Scenario: A batch whose runs record no actor reports none
    Given a batch whose runs record no actor
    When the batch history and the batch summary are read
    Then both report no actor

  @integration
  Scenario: Reading the actor keeps the run set query bounded to the page
    Given a page of batch history is read
    When the queries it sends are counted
    Then the actor is read only in the query already bounded to the page
    And the query that counts the whole run set never touches run metadata
