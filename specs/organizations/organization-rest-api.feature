Feature: Organization REST API

  As an operator provisioning LangWatch from code
  I want to read and edit my organization's profile over REST
  So that organization settings live in the same declaration as everything else

  Background:
    Given an organization on an Enterprise plan
    And I am authenticated with an organization-scoped API key

  # The organization is implied by the credential, so there is no id in the
  # path: a key can only ever read and edit the organization it belongs to.
  # Reading returns every field an edit accepts, minus the ones this API does
  # not own, so a declaration can be applied and then read back to compare.

  # ============================================================================
  # Read
  # ============================================================================

  @integration
  Scenario: Fetching the organization returns the caller's organization
    When I fetch the organization
    Then the response status is 200
    And it is the organization my credential belongs to
    And it carries the name, slug, support contact, presence and trace sharing settings

  @integration
  Scenario: Fetching the organization without credentials is refused
    When I fetch the organization with no authorization header
    Then the request is refused with code missing_credentials and status 401

  # ============================================================================
  # Update
  # ============================================================================

  @integration
  Scenario: Renaming the organization takes effect
    When I update the organization name to "Acme Platform"
    Then the response status is 200
    And fetching the organization returns the new name

  @integration
  Scenario: An empty organization name is refused
    When I update the organization name to an empty string
    Then the request is refused with code validation_error and status 422
    And the organization name is unchanged

  # ============================================================================
  # Fields this API does not own
  # ============================================================================
  #
  # Claiming a single sign-on domain reroutes where new signups land, so it is
  # not something an organization-scoped key may set for itself, and it is not
  # something this API reports either.

  @integration
  Scenario: Single sign-on fields are not exposed
    Given the organization has a single sign-on domain and provider configured
    When I fetch the organization
    Then the response contains neither the single sign-on domain nor the provider
    And an update that tries to set them leaves both unchanged

  # ============================================================================
  # Version namespaces
  # ============================================================================
  #
  # Amended with packages/api/adrs/002-explicit-version-namespaces.md: every
  # URL names its namespace. One handler answers on the dated namespace an
  # integration pins itself to and on the moving latest alias; the bare path
  # is gone (404 via the namespace guard) and "unversioned" went with it. The
  # response says which namespace answered, so a client that believed it was
  # pinned can tell that it is not.

  @integration
  Scenario: The organization endpoint answers on its dated and latest paths
    When I fetch the organization through the dated version namespace
    Then the response status is 200
    And the response names that version and reports it as stable
    When I fetch the organization through the latest namespace
    Then the response status is 200
    And the response reports the version as latest
    When I fetch the organization through the bare path
    Then the response status is 404
    When I fetch the organization through a version namespace that does not exist
    Then the response status is 404
