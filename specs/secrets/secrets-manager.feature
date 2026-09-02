Feature: Secrets Manager
  As a project member
  I want secrets to be governed by the RBAC permission system
  So that access to sensitive credentials is controlled by team roles

  # THIS FILE WAS 0/0 BOUND. It carried one untagged scenario, so
  # check-feature-parity counted nothing and reported it green while binding
  # nothing at all — the trap the annotations family named. Everything below the
  # vocabulary scenario is the page's own behaviour, which had never been
  # written down here, now stated and bound.
  #
  # The vocabulary scenario stays UNTAGGED, and deliberately: the suite that
  # covers it is `platform/app/src/server/api/__tests__/rbac.secrets.test.ts`,
  # and `platform/app` is deletes-only while the migration runs, so the
  # `@scenario` docblock that would bind it cannot be added. It gets its tag
  # when that suite moves into the authz or secret package.
  Scenario: Secrets resource is registered in the RBAC system
    Given the RBAC permission system is configured
    Then the "secrets" resource exists in the Resources enum
    And the ADMIN role includes "secrets:view" and "secrets:manage" permissions
    And the MEMBER role includes "secrets:view" and "secrets:manage" permissions
    And the VIEWER role includes "secrets:view" but not "secrets:manage"
    And the CUSTOM fallback role includes "secrets:view" but not "secrets:manage"
    And organization role permissions are unchanged
    And "secrets" appears in the ordered resources for the permissions UI
    And the valid actions for "secrets" are "view" and "manage"

  @integration
  Scenario: View secrets list
    Given the project has secrets stored
    When I open Settings > Secrets
    Then each secret is listed by name
    And each row says who created it and when it last changed

  @integration
  Scenario: Empty state
    Given the project has no secrets
    When I open Settings > Secrets
    Then the page says none are configured
    And it says what secrets are for

  @integration
  Scenario: Add a secret
    Given I may manage secrets
    When I add a secret
    Then the name is stored upper snake case, as a code block reads it
    And the value is typed into a password field
    And the value is sent once and never comes back

  @integration
  Scenario: Update a secret's value
    Given I may manage secrets
    When I replace a secret's value
    Then the new value is typed into a password field
    And the secret is addressed by its id rather than by its name

  @integration
  Scenario: Permission gate on managing secrets
    Given I may view secrets but not manage them
    When I open Settings > Secrets
    Then I see every secret's name
    And I am offered no way to add, change or delete one

  # The property the whole page exists to keep. The stored value is write-only:
  # there is no reveal control anywhere, and the list wire cannot carry a value
  # because the contract's row schema is strict and does not declare one.
  @unit @integration
  Scenario: A secret's value is never readable after it is stored
    Given a secret is stored in the project
    When anything reads the project's secrets
    Then the answer carries the name, the timestamps and who touched it
    And it carries no value, encrypted or otherwise
    And the page offers no control that would reveal one

  # Four refusals this feature raises, none of which had customer-facing copy:
  # they are not listed in the client presentation registry, so every one of
  # them reached the customer as the generic "something went wrong on our side".
  @unit @integration
  Scenario: A refused secret write says why
    Given a secret write is refused
    When the refusal names a cause the customer can act on
    Then the page says which cause, and what to do about it
    And it never prints the refusal's wire message, which is its code
    And a refusal with no recognised cause falls back to naming the action
