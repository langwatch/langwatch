Feature: The authz-members-required lint rule
  Authorization fails closed (ARCHITECTURE.md §8). A question an exported authorization type
  in `packages/api/src/access/` or `packages/api/src/hosting/api-door.ts` lets a process leave
  unanswered is a check the door may skip, so every method or function-valued member there is
  required. Data members and parameter fields are not questions; the few questions left optional
  on purpose are exempted by name, each with the reason its absence is refused or harmless.

  @unit
  Scenario: An optional question on an authorization type is reported
    Given an exported authorization type with an optional method or an optional function member
    When the authz-members-required rule runs over it
    Then it reports optionalMember naming the type and the member

  @unit
  Scenario: A deliberately optional question is accepted
    Given RestIdentity with its optional authorize and authorizePlatform
    When the authz-members-required rule runs over it
    Then it reports nothing

  @unit
  Scenario: Optional data and parameter fields are accepted
    Given an exported authorization type with an optional data member and an optional parameter field
    When the authz-members-required rule runs over it
    Then it reports nothing

  @unit
  Scenario: Types outside the authorization ports are accepted
    Given an unexported type, a test file and a file outside the governed paths
    When the authz-members-required rule runs over them
    Then it reports nothing
