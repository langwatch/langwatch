@governance @identity
Feature: Erasing a person from the governance data, and making it stick
  Providers put people's names and email addresses on the rows we pull. When
  someone asks to be erased, removing what we hold is only half the job: the
  pullers re-read the last thirty days every day, so whatever we delete comes
  straight back tomorrow unless something remembers it must not. Erasure is
  keyed on the person a provider named, not on a LangWatch account, because
  most of these people have never had one. The money stays; the name goes.
  Decision: ADR-128.

  Background:
    Given an organization whose providers name people on the rows we pull

  # ── The identity records themselves ───────────────────────────────────────

  @integration
  Scenario: A person can only be linked to one account at a time
    Given a provider-named person already linked to an account
    When a second link is opened for that same person while the first is open
    Then the second link is refused
    And the refusal names the overlap rather than a duplicate row

  @integration
  Scenario: A link that covers no time at all is refused
    Given a link whose start and end are the same instant
    When it is saved
    Then it is refused
    # An empty span overlaps nothing — not even itself — so the overlap rule
    # cannot see it. It would file a person against no time at all and read as
    # if the link had never been made.

  @integration
  Scenario: A link that ends before it starts is refused
    Given a link whose end is earlier than its start
    When it is saved
    Then it is refused

  @integration
  Scenario: A closed link and a new one for the same person can coexist
    Given a person whose earlier link was closed when they left
    When a new link is opened starting after the old one closed
    Then both links are kept
    # This is what makes a re-issued email address survivable: last year's
    # spend stays with last year's person.

  # ── Which tenants an organization's data lives in ─────────────────────────

  @unit
  Scenario: The first time an organization's governance area is used it is recorded
    Given an organization that has never ingested anything
    When its governance area is resolved for the first time
    Then that area is recorded against the organization

  @unit
  Scenario: Resolving the same area again does not record it twice
    Given an organization whose governance area is already recorded
    When its governance area is resolved again
    Then it is still recorded once
    And the record shows it was used more recently

  @integration
  Scenario: Areas the organization used before today are still found after one is retired
    Given an organization that used one governance area and then another
    When the whole history is asked for
    Then both areas are returned
    # The live lookup only ever finds today's, and returns nothing once one is
    # retired — which is how an erasure could delete nothing and report
    # success.

  @integration
  Scenario: Organizations that already ingested keep their area when the records are introduced
    Given organizations that ingested before any of this was recorded
    When the records are introduced
    Then each organization's existing area is already in its history
    And a retired area is included rather than skipped

  # ── Erasing someone ────────────────────────────────────────────────────────

  @unit
  Scenario: Erasing a person replaces their identifier everywhere it is stored
    Given a provider-named person whose identifier is their email address
    When they are erased
    Then their record keeps its place in the data
    And their identifier and displayed name are replaced by a stable stand-in
    And their link to a LangWatch account no longer names that account

  @integration
  Scenario: The link's dates survive the erasure
    Given an erased person who had been linked to an account
    When their links are read back
    Then the links are still there with the dates they always had
    # Removing the link would rewrite history to claim it never existed. The
    # erasure removes the identifier, not the past.

  @unit
  Scenario: Erasing the same person twice changes nothing the second time
    Given a person who has already been erased
    When they are erased again
    Then nothing further is recorded
    And the stand-in they already carry is reported unchanged
    # The original is gone, so a second pass would only ever hash the stand-in
    # and add an entry that can never match anything a provider sends.

  @unit
  Scenario: Erasure refuses to run without its secret
    Given a deployment with no erasure secret configured
    When an erasure is attempted
    Then it refuses and says which setting is missing
    # Hashing with an empty secret produces a list that looks real and
    # protects nothing, and nobody would find out except whoever broke it.

  @unit
  Scenario: A person from another organization cannot be erased
    Given a person belonging to a different organization
    When an erasure names them
    Then it refuses

  # ── Making it stick ────────────────────────────────────────────────────────

  @unit
  Scenario: The next pull does not bring an erased person back
    Given an erased person whose provider still reports them
    When the next pull reads the same thirty days
    Then the rows naming them are not stored
    And the run says how many it left out

  @unit
  Scenario: Erasing someone at one provider does not silence them at another
    Given the same email address in use at two providers
    And it was erased at only one of them
    When the other provider's next pull reports it
    Then those rows are stored as usual

  @unit
  Scenario: An erased person's conversations stop being exported
    Given an erased person whose provider still reports their conversations
    And the source sends conversations on to a project of the customer's own
    When the next pull reads the same thirty days
    Then nothing is sent to that project
    # This export leaves our storage entirely, carrying the provider's user id
    # and the question and the answer. It is the write an erasure most has to
    # reach, and the daily pull would otherwise repeat it forever.

  @unit
  Scenario: Suppression removes only the erased person from the export
    Given a pull carrying one erased person and one who was not
    When the conversations are sent on to the customer's project
    Then the other person's conversation arrives
    And the erased person's identifier appears nowhere in it

  @unit
  Scenario: A pull still runs when the erasure list cannot be read
    Given the erasure list is unreadable
    When a pull runs
    Then it stores its rows rather than failing
    And it records that it could not check
    # A pull that refused would turn a brief outage into missing cost data,
    # and the check is applied again on the next run.

  @unit
  Scenario: A process with no secret says so instead of quietly ignoring the list
    Given somebody in the organization has been erased
    And this process has no erasure secret configured
    When a pull runs
    Then it records that it could not check
    # Without a secret the list cannot be evaluated at all. On a deployment
    # that has erased nobody that is the ordinary state and stays silent; once
    # somebody has been erased it is a misconfiguration, and the usual shape is
    # a split deployment where one side got the secret and the other did not.

  # ── The money rows ─────────────────────────────────────────────────────────

  @integration
  Scenario: The daily totals cannot be edited to remove a name
    Given daily totals holding an erased person's identifier
    When an edit is attempted on the identifier itself
    Then the storage refuses it
    # The identifier is part of what addresses the row, so a changed one is a
    # different row rather than an edited one. This is why erasure removes and
    # rebuilds instead.

  @integration
  Scenario: An erased person's spend comes back under the stand-in, with the same total
    Given daily totals holding an erased person's spend
    When they are erased and the affected days are rebuilt
    Then no row carries the original identifier
    And the stand-in carries the same total the original did

  @unit
  Scenario: The rebuilt money rows carry the stand-in, not the identifier
    Given an organization that has erased somebody
    When their spend is summarized again
    Then the summary is filed under the stand-in
    And everybody else's spend is still filed under their own identifier

  @unit
  Scenario: The rebuild the erasure asks for cannot re-derive the identifier
    Given a person being erased
    When the erasure asks for the affected days to be rebuilt
    Then the summarizer is already substituting the stand-in
    # The rebuild reads the raw records, which still hold the identifier. If the
    # substitution is not already live at that moment, the rebuild faithfully
    # writes the erased identifier back and the erasure reports success.

  @unit
  Scenario: A process with no secret refuses to write the money row
    Given somebody in the organization has been erased
    And this process has no erasure secret configured
    When a money row for that organization is about to be written
    Then the write is refused and names the missing setting
    And an organization that has erased nobody keeps writing its rows
    # There is no safe value to write here. The identifier is the erased
    # person's address, and a placeholder would collapse every actor in the
    # organization into one row and quietly destroy what a total is made of.
    # So the rows stop until somebody sets the variable.

  @integration
  Scenario: Rebuilding twice lands on the same stand-in
    Given an erased person whose days have been rebuilt once
    When the same days are rebuilt again
    Then the stand-in is identical to the one the first rebuild produced
    # Nothing anywhere maps a stand-in back to the identifier it replaced, so
    # the only thing making rebuilds agree is that the stand-in is computed
    # from the identifier the same way every time.

  @integration
  Scenario: Erasure reaches areas the organization no longer uses
    Given an erased person with spend in an area the organization has retired
    When they are erased
    Then that area's rows are removed too
    # Personal data does not stop existing in an area that stopped being the
    # current one.

  @unit
  Scenario: An erasure interrupted after the totals were removed finishes on the next attempt
    Given an erasure that removed the daily totals and then failed
    When the erasure is asked for again
    Then it rebuilds the days the first attempt could not
    And it says it was picking up unfinished work
    # Until this, the second attempt saw the person already erased, did nothing,
    # and reported success — while those days stayed short by the erased amount
    # with nothing anywhere recording that a rebuild was owed.

  @unit
  Scenario: Days too old to rebuild are reported rather than passed over
    Given an erased person with spend older than the history we keep
    When they are erased
    Then those days' rows are removed
    And the erasure names the days it could not rebuild
    # Those days' totals are genuinely lower afterwards. Leaving the personal
    # data in place instead is not an option, so the honest thing is to say
    # which days moved.

  @unit
  Scenario: A day nobody was erased on costs nothing to check
    Given an organization that has never erased anybody
    When its spend is summarized
    Then the identifier is stored exactly as the provider sent it

  # ── The governance area is not a workspace ─────────────────────────────────

  @unit
  Scenario: The governance area cannot be archived through the projects API
    Given an organization's hidden governance area
    When a request tries to archive it as if it were a project
    Then the request is refused
    And the refusal says it is an internal record rather than a workspace

  @unit
  Scenario: The governance area cannot be renamed or moved through the projects API
    Given an organization's hidden governance area
    When a request tries to rename it or move it to another team
    Then the request is refused

  @integration
  Scenario: The governance area cannot be re-keyed through the projects API
    Given an organization's hidden governance area
    When a request tries to issue it a new key
    Then the request is refused
    # Its key is what the receiver ingests under; replacing it breaks ingest.

  @integration
  Scenario: Reading the governance area by its id reports it as absent
    Given an organization's hidden governance area
    When a request asks for it by id
    Then it is reported as not found
    # It is left out of every list, so answering a read would be the one thing
    # left that confirms it exists.

  @unit
  Scenario: An ordinary project is unaffected by the guard
    Given an ordinary project in the same organization
    When it is renamed, archived, or read by id
    Then each request succeeds as before
