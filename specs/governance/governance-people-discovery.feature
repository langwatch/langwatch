@governance @identity
Feature: Provider rows become discovered people
  Every pulled row already names who did the thing — an email on an OpenAI
  cost line, a directory id on a Copilot transcript, whatever Databricks put
  in executed_by. Until now those names were read for money and audit and
  then forgotten: nothing wrote them down as people, so the match engine
  swept an empty list and the People screen had nobody to show. This is the
  feed the engine spec promised — "the trigger arrives with the feed that
  discovers people" — minus the trigger, which stays a button a person
  presses (governance-people-screen.feature).
  Decision: ADR-128 sections 10 and 11.

  Background:
    Given an organization with a pull source delivering events

  # ── Discovery ─────────────────────────────────────────────────────────────

  @integration
  Scenario: An actor on a pulled row becomes a discovered person
    When a pulled event names an actor this organization has never seen
    Then a discovered person exists for that provider and identifier
    And their first-seen and last-seen are the event's own time
    # The event's time, not the pull's. A backfill of July read in September
    # discovers people who were active in July.

  @integration
  Scenario: Seeing the same actor again moves last-seen forward only
    Given a discovered person seen before
    When a later pulled event names the same actor
    Then their last-seen moves to the later event's time
    And their first-seen stays where it was

  @integration
  Scenario: The same identifier on two providers is two discovered people
    When two different providers both name the same email
    Then each provider gets its own discovered person
    # "m.silva on Anthropic" and "m.silva on OpenAI" are two claims by two
    # systems. The match engine is what may decide they are one human.

  @integration
  Scenario: A row naming nobody discovers nobody
    When a pulled event carries an empty actor
    Then no discovered person is written
    # Seat reports deliberately name no person; inventing one would attribute
    # the tenant's procurement to a blank string.

  @unit
  Scenario: A bare-UUID Databricks actor is recorded as a machine login
    When a Databricks event's actor is a bare UUID
    Then the discovered record's kind is machine login, not person
    # Deterministic per ADR-128 §10: under app-only auth humans surface as
    # emails and service principals as UUIDs. Never guessed from name shape,
    # and never per-provider generalized — a Copilot directory id is a person.

  @integration
  Scenario: An erased identifier is never re-discovered
    Given a person who has been erased
    When the next pull reads a window that still contains their activity
    Then no discovered person row carries their identifier in plain text
    # The same do-not-reimport list that keeps their money rows out keeps
    # their person row out. Discovery running before that check would undo
    # every erasure on the next thirty-day re-read.

  @integration
  Scenario: Discovery failing does not cost the run its events
    When writing a discovered person fails
    Then the pulled events are still recorded
    And the failure is logged
    # Discovery is a side-channel of the pull, not its purpose. The next run
    # sees the same actor again; audit rows missed are gone for good.

  # ── The directory read ────────────────────────────────────────────────────
  # The Copilot source's tenant app can also read the directory itself —
  # who exists, their name, their department. Same credential, one more
  # consent (User.Read.All), so it is off until switched on.

  @unit
  Scenario: The directory is not read unless switched on
    Given a Copilot source with the directory read left off
    When the source runs
    Then no directory request is made

  @unit
  Scenario: The directory is read once a day, not once a tick
    Given a Copilot source with the directory read switched on
    And the directory was already read today
    When the source runs again today
    Then no directory request is made
    # A directory changes on people-time. Reading it every two minutes asks
    # Graph four hundred times for the same answer.

  @unit
  Scenario: A directory read that fails holds the day and delivers the rest
    Given a Copilot source with the directory read switched on
    When the directory request fails
    Then the run still delivers its conversations
    And the directory day is held to be retried, not marked read
    # Same contract as the seat read, including naming HTTP 403 for what it
    # is: consent never granted, not a role misassigned.

  @integration
  Scenario: A directory row enriches a discovered person's display text
    Given a discovered person whose display text is a bare directory id
    When the directory names that id with a person's name
    Then the discovered person's display text becomes that name
    # A Copilot transcript knows people only as GUIDs. The directory is the
    # one source that knows what the GUID is called.

  @integration
  Scenario: A directory row records the department it names on the person
    Given the directory names a person and the department they are filed under
    When the pull is recorded
    Then the discovered person carries that department
    # The department the directory asserts is the only department fact that
    # exists for somebody holding no LangWatch account, which on a fresh
    # tenant is nearly everybody. Kept on the person, not on a Department row:
    # see the department scenarios below for the entity the org actually
    # attributes spend by.

  @integration
  Scenario: A later directory row naming no department keeps the recorded one
    Given a discovered person whose recorded department came from the directory
    When a later directory row for them names no department
    Then the recorded department is unchanged
    # Same widen-only posture as the display text. The read is idempotent and
    # daily, and the pullers spell a missing field as blank, so a blanking
    # write would erase a real department every morning for anyone the tenant
    # filed under nothing.

  @integration
  Scenario: Erasing a person removes the department the directory gave them
    Given a discovered person carrying a directory department
    When their identity is erased
    Then the row keeps its spend but carries no department
    # The department describes the person, not the money. Nothing rolls up by
    # it, so keeping it buys the surviving row nothing and leaves a personal
    # detail on somebody we were asked to forget.

  # ── Departments ride the directory row ────────────────────────────────────
  # The directory's department field lands on the SAME entities the SCIM
  # costCenter push writes: resolve the department by name (creating it if
  # new), assign the member. No parallel department shape, no free text.

  @integration
  Scenario: A directory department lands on the member it proves
    Given a directory row whose identity proves a platform member
    And the row carries a department name that already exists
    When the directory sync runs
    Then that member is assigned to that department
    # Proof is the same standard the match engine accepts: the directory id
    # the org's own SSO connection recorded, or an address the member has
    # confirmed. An unconfirmed address assigns nobody.

  @integration
  Scenario: A department the organization has not created yet is created
    Given a directory row naming a department that does not exist
    When the directory sync runs
    Then an active department with that name exists
    And the proven member is assigned to it
    # resolveByNameOrCreate — the identical call SCIM costCenter provisioning
    # makes, so an IdP-run org and a directory-pull org build the same shape.

  @integration
  Scenario: A blank directory department leaves the member's assignment alone
    Given a member an admin assigned to a department by hand
    And the directory row for that member carries no department
    When the directory sync runs
    Then the member's assignment is untouched
    # Deliberately weaker than SCIM push, which clears on empty. A pull is an
    # observation, not a provisioning command: Entra tenants routinely leave
    # the field blank, and blank must not erase an admin's hand-work daily.

  @integration
  Scenario: A directory row proving no member assigns nobody
    Given a directory row whose identity proves no platform member
    When the directory sync runs
    Then no department assignment is made
    And the row's person is still discovered
    # They appear on the People screen as discovered; the day they are linked,
    # the next directory read assigns their department without anyone asking.

  @integration
  Scenario: An erased identifier in the directory is skipped entirely
    Given a person who has been erased
    When the directory read returns a row naming their identifier
    Then no discovered person, display text, or assignment is written from it
