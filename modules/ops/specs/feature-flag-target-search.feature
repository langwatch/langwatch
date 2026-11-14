Feature: Search for the organization, project or user a feature flag rule targets
  An operator writing a targeting rule on the Ops Feature Flags page picks its
  organization, project or user by searching for it instead of typing an id.
  Many organizations share a name, so every result and every picked target
  shows what tells it apart: an organization's slug, short id, plan, member
  count, creation date and administrator email; a project's organization; a
  user's email and organizations. The reads ask ops:view at the platform tier,
  and ops asks the owning modules through their Api, never their tables.

  @integration
  Scenario: an operator finds an organization by name, slug or id
    Given two organizations named "Acme Labs" with different slugs
    When the operator searches organizations for "acme"
    Then both organizations are listed
    And each shows its slug, a short id, its plan, its member count, its
      creation date and its administrator email

  @integration
  Scenario: an operator finds a project by name, slug or id
    Given a project "Checkout bot" in the organization "Acme Labs"
    When the operator searches projects for "checkout"
    Then the project is listed with its slug and the name and slug of its organization

  @integration
  Scenario: an operator finds a user by email, name or id
    Given a user "Dana" at "dana@acme.test" who belongs to "Acme Labs"
    When the operator searches users for "dana@"
    Then the user is listed with their email, name and the organizations they belong to

  @integration
  Scenario: stored rule targets render with their names
    Given a flag whose stored rules name an organization, two projects and a user by id
    When the operator reads those targets
    Then each id comes back with the same identifying details a search shows
    And an id that no longer exists is left out, so the dialog shows it as unknown

  @integration
  Scenario: a search with an empty query is refused
    When the operator searches with an empty query
    Then the read is rejected as invalid input

  @integration
  Scenario: picking a search result fills the rule with its id
    Given an operator opens the targeting rules for a flag
    When the operator searches for an organization and picks a result
    Then the rule shows the organization as a chip with its name, slug and plan
    And saving the dialog stores that organization's id

  @integration
  Scenario: a project rule and a user rule take several picked targets
    Given an operator opens the targeting rules for a flag
    When the operator picks two projects for a project rule
    Then both show as chips with their organization
    And removing one chip leaves the other in the saved rule

  @integration
  Scenario: an existing rule that holds raw ids shows their names
    Given a flag whose stored rule names an organization by id
    When the operator opens the targeting rules
    Then the organization shows as a chip with its name and slug, not only the id

  @integration
  Scenario: an id the directory does not know still shows and can be removed
    Given a stored rule naming an organization id that no longer exists
    When the operator opens the targeting rules
    Then the chip shows the raw id marked as not found
    And the operator can remove it

  @integration
  Scenario: a failed lookup does not call stored targets unknown
    Given a stored rule naming an organization that exists
    And reading the stored ids fails
    When the operator opens the targeting rules
    Then the chip shows the raw id with a retry
    And it is not marked as not found
