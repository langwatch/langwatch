Feature: Shared organization service
  Organization, team, and group invariants are implemented once for all features.

  Scenario: A caller requires the oldest team
    Given an organization has one or more teams
    When a feature gets the organization's oldest team
    Then the organization service returns the oldest team identifier
    And the caller performs no nullable check

  Scenario: An organization has no team
    Given an organization has no team
    When a feature gets the organization's oldest team
    Then the organization service throws the organization-owned no-team error

  Scenario: A feature needs organization behaviour
    When the feature is composed
    Then it receives the process-owned organization service
    And it does not query Organization or Team persistence directly

  Scenario: A disabled member is checked for active access
    Given the user still has a disabled organization membership
    When a feature checks whether the user is a member without including deactivated members
    Then the organization service returns false
    And the same check can include the retained disabled membership when required

  Scenario: Trace sharing is disabled for an organization
    Given trace sharing is currently enabled
    When a management transport commits the organization settings update
    Then the organization service reports that trace-share revocation is required
    And the transport lists each project and revokes its trace shares after the commit

  Scenario: A request manages a shared team
    Given an organization-authenticated request has the required team permission
    When it creates, reads, updates, or archives a shared team
    Then the request delegates to the process-owned organization service
    And no service or repository is constructed for that request

  Scenario: A request changes team membership
    Given the target is a shared team
    And the user belongs to the organization
    When the request adds or removes the user
    Then the organization service writes the membership through AuthZ grants

  Scenario: A request mutates a personal team
    Given the target is a personal workspace team
    When the request archives it or changes its membership
    Then the organization service refuses with the personal-team domain error

  Scenario: A request lists a team's related resources
    When the request lists team members or projects
    Then it composes the AuthZ and Project services
    And it does not query role binding or project persistence directly

  Scenario: Team membership is projected from grants
    Given a user has more than one binding on the same team
    When the organization service presents the team's members
    Then it derives membership from AuthZ bindings
    And it presents the highest-priority effective role once
    And it preserves the lower-priority additive binding

  Scenario: A non-manager reads team membership
    Given the caller belongs to the team but cannot manage it
    When the caller reads the team
    Then the caller can see only their own member email

  Scenario: A non-member gets a team by slug
    Given the caller does not belong to the requested team
    When the caller gets that team by slug
    Then the organization service throws the same error as for a missing team

  Scenario: A team edit would remove the last administrator
    Given the proposed direct membership leaves no direct administrator
    And no administrator is inherited through a group
    When the organization service validates the edit
    Then it refuses before changing the team or emitting grant commands

  Scenario: A group supplies the remaining administrator
    Given the proposed edit removes the last direct administrator
    And a member of an administrator group remains
    When the organization service validates the edit
    Then it accepts the edit

  Scenario: Concurrent team membership edits race
    Given two editors read the same team revision
    When the first edit wins the repository revision fence
    Then the second edit is refused as stale
    And only the winning edit emits durable grant commands

  Scenario: A team membership write partially fails
    When the service changes direct team membership
    Then replacement access is attached before existing access is changed
    And removed access is revoked last
    And a failure tends toward retaining access rather than unexpectedly removing all access

  Scenario: A request manages an organization group
    When Hono or tRPC creates, reads, renames, or deletes a group
    Then it delegates to the process-owned organization service
    And it constructs no request-scoped service or repository

  Scenario: A group receives scoped access
    Given the group and scope belong to the same organization
    And any custom role is user-created and assignable at that scope
    When a binding is added to the group
    Then the organization service writes it through the AuthZ grants service
    And no Organization repository reads or writes RoleBinding rows

  Scenario: A group batch edit partially fails
    When bindings are removed and group membership is changed in one request
    Then the service revokes access before changing membership
    And it attaches new access only after the group edit succeeds
