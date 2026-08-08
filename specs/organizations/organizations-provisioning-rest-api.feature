Feature: Organization provisioning REST API for self-hosted deployments

  As an administrator standing up a self-hosted LangWatch
  I want to create organizations with an instance-wide credential
  So that an empty deployment can be provisioned from code with no browser step

  Background:
    Given a self-hosted deployment
    And an instance administrator credential is configured
    And I present that credential

  # This is the only surface that exists before any organization does, so it
  # authenticates against the instance rather than an organization, and it is
  # the one place a bootstrap credential can come from: creating an organization
  # hands back an admin key for it, and every other management API takes over
  # from there. On cloud, and on any deployment that has not configured the
  # credential, the family is simply not there.

  # ============================================================================
  # Create
  # ============================================================================

  @integration
  Scenario: An instance administrator creates an organization with a bootstrap key
    When I create an organization named "Acme" with slug "acme"
    Then the response status is 201
    And the response carries the organization's id, name and slug
    And it carries an admin API key with its token
    And that key can immediately manage the new organization

  @integration
  Scenario: A slug outside the documented shape is refused
    When I create an organization with a slug that is not lowercase letters, digits and hyphens
    Then the request is refused with status 422
    And no organization is created

  @integration
  Scenario: A duplicate organization slug is refused
    Given an organization with slug "acme" already exists
    When I create another organization with slug "acme"
    Then the request is refused with code organization_slug_taken and status 409
    And no second organization is created

  @integration
  Scenario: A failed bootstrap key leaves no organization behind
    When I create an organization whose bootstrap key cannot be created
    Then the request fails
    And no organization with that slug remains
    And retrying the same slug with a valid key name succeeds

  # ============================================================================
  # Read
  # ============================================================================

  @integration
  Scenario: Listing organizations requires the instance key
    Given two organizations exist on the deployment
    When I list organizations without the instance administrator credential
    Then the request is refused with status 401
    And listing them with the credential returns both

  @integration
  Scenario: Fetching a provisioned organization returns what creation reported
    Given I created an organization with the instance administrator credential
    When I fetch it by the id creation returned
    Then the response status is 200
    And the id, name and slug match what creation returned

  @integration
  Scenario: Fetching an unknown organization id is not found
    When I fetch an organization id that does not exist with the credential
    Then the request is refused with status 404

  # ============================================================================
  # Availability
  # ============================================================================

  @integration
  Scenario: Organization provisioning is absent without an instance key
    Given no instance administrator credential is configured
    When I create an organization
    Then the response status is 404

  @integration
  Scenario: Organization provisioning is absent on cloud deployments
    Given a cloud deployment with an instance administrator credential configured
    When I create an organization
    Then the response status is 404
