@unit
Feature: Permission resolution
  As the platform
  I need one answer to "may this caller do this here"
  So that every surface gates on the same decision instead of its own copy

  The decisions below were pinned by the monolith's rbac suites before the
  authorization engine took them over. They are restated here against the
  seams that make them now: the manage-implication rule in the registry, the
  built-in role bags, the service's resolution over stored rows, and the
  tRPC check that carries the verdict into a request.

  # ==========================================================================
  # The manage-implication rule
  # ==========================================================================

  Scenario: A direct grant satisfies its own request
    Given a caller holding "workflows:view"
    When "workflows:view" is requested
    Then the request is satisfied

  Scenario: A manage grant satisfies the read and write actions on its resource
    Given a caller holding "workflows:manage"
    When view, create, update or delete is requested on workflows
    Then each request is satisfied

  Scenario: A view grant never satisfies manage
    Given a caller holding "workflows:view"
    When "workflows:manage" is requested
    Then the request is refused

  Scenario: A grant on one resource never reaches another
    Given a caller holding "datasets:manage"
    When any workflows permission is requested
    Then the request is refused

  Scenario: An empty permission bag satisfies nothing
    Given a caller holding no permissions
    When any permission is requested
    Then the request is refused

  Scenario: Sharing a trace is not implied by any manage grant
    Given traces carry read and share but no manage action
    When a caller holding "traces:share" requests "traces:view"
    Then the request is refused

  Scenario: A malformed permission request matches nothing
    Given a caller holding "workflows:manage"
    When a request names a bare resource, a bare action or an empty action
    Then the request is refused

  Scenario: Permission comparison is case sensitive
    Given a caller holding "workflows:manage"
    When "WORKFLOWS:VIEW" is requested
    Then the request is refused

  Scenario: A mixed custom bag resolves each resource on its own grant
    Given a custom role granting manage on workflows and view on datasets
    When permissions are requested across both resources
    Then each resource answers from its own grant, never the widest one

  # ==========================================================================
  # What the built-in roles carry
  # ==========================================================================

  Scenario: A team admin holds the whole project lifecycle
    Given a team admin
    When they view, create, update, delete or manage a project
    Then every action is allowed
    And they may administer the team

  Scenario: A team member creates and updates projects but never deletes one
    Given a team member
    When they create or update a project
    Then the action is allowed
    But deleting or administering the project is refused

  Scenario: A team viewer reads and changes nothing
    Given a team viewer
    When they read a project, its workflows and its datasets
    Then the reads are allowed
    But every create, update, delete and manage is refused

  Scenario: Cost visibility starts at team member
    Given the built-in team roles
    When cost is requested
    Then a member and an admin may see it and a viewer may not

  Scenario: Traces carry read and share, never manage
    Given the built-in team roles
    When "traces:manage" is requested
    Then no role grants it
    And only a member and above may share a trace

  Scenario: A CUSTOM team role falls back to the viewer bag
    Given a team binding on the CUSTOM role with no permissions of its own
    When a permission is requested
    Then it resolves against the viewer bag

  Scenario: An organization admin holds the organization and its governance surfaces
    Given an organization admin
    When they act on the organization or any governance surface
    Then the action is allowed
    And a manage grant satisfies a view-level check

  Scenario: A plain organization member holds no governance permission
    Given a plain organization member
    When any governance permission is requested
    Then the request is refused

  Scenario: A lite member reads the product, comments on it, and configures nothing
    Given a lite member
    When they read the product surfaces or annotate a trace
    Then the action is allowed
    But every configuration and gateway permission is refused

  # ==========================================================================
  # Resolution over stored rows
  # ==========================================================================

  Scenario: An unresolvable scope id is denied like any other
    Given a project id that resolves to no project
    When a permission is checked on it
    Then the check is denied and carries no organization role

  Scenario: A caller with no organization membership resolves nothing
    Given a caller with a binding but no membership in the owning organization
    When a permission is checked
    Then the check is denied for want of membership

  Scenario: A group binding authorizes exactly like a direct one
    Given a caller whose only binding reaches them through a group
    When a permission that binding carries is checked
    Then the check is allowed

  Scenario: A built-in role binding grants its bag
    Given a caller with an admin binding on the project's team
    When a permission that role carries is checked
    Then the check is allowed

  Scenario: A custom role binding is authoritative for its holder
    Given a caller bound to a custom role
    When a permission the role lists is checked
    Then the check is allowed
    And a permission it does not list is denied while the organization role is still reported

  Scenario Outline: Every decision carries the caller's organization role
    Given a caller who is a <orgRole> of the organization
    When a permission is checked on one of its projects
    Then the decision reports <orgRole>

    Examples:
      | orgRole  |
      | ADMIN    |
      | MEMBER   |
      | EXTERNAL |

  Scenario Outline: A team role decides the outcome at project scope
    Given a caller with a <teamRole> binding on the project's team
    When they attempt an action requiring "<permission>"
    Then the action is <outcome>

    Examples:
      | teamRole | permission      | outcome |
      | ADMIN    | analytics:view  | allowed |
      | ADMIN    | datasets:manage | allowed |
      | ADMIN    | team:manage     | allowed |
      | MEMBER   | analytics:view  | allowed |
      | MEMBER   | datasets:manage | allowed |
      | MEMBER   | team:manage     | denied  |
      | VIEWER   | analytics:view  | allowed |
      | VIEWER   | datasets:manage | denied  |
      | VIEWER   | team:manage     | denied  |

  Scenario: The demo project opens read-only for a signed-in caller
    Given a configured demo project
    When a signed-in caller with no membership opens it
    Then the read-only tour is allowed
    And anything the tour does not carry is refused
    And the same id is an ordinary project when no demo project is configured

  Scenario: Every organization member holds the member floor
    Given an organization member with no bindings and no teams
    When they read the organization or the personal tool catalogue
    Then the reads are allowed
    But managing the organization is refused

  Scenario: A lite member is never promoted by an organization-scoped binding
    Given a lite member carrying a stray organization-scoped admin binding
    When they read the organization
    Then the read is allowed
    But managing the organization is refused

  Scenario: A team administrator gains no organization permission
    Given a plain organization member who administers a team
    When they attempt to manage the organization
    Then the attempt is refused

  Scenario: An organization admin manages any team without joining it
    Given an organization admin with an organization-scoped binding and no team membership
    When they administer a team in that organization
    Then the action is allowed

  Scenario: A lite member is refused every mutating permission
    Given a lite member with a viewer binding
    When they attempt any mutating permission at project or team scope
    Then the attempt is refused as a lite-member restriction
    And the readable permissions of the lite bag stay allowed

  Scenario: A lite member's custom role overrides the cap in both directions
    Given a lite member bound to a non-empty custom role
    When a permission the role lists is checked
    Then the check is allowed
    And a permission it does not list is denied

  # ==========================================================================
  # The legacy fallbacks that predate role bindings
  # ==========================================================================

  @regression
  Scenario: An organization admin from before role bindings keeps their gateway and audit access
    Given an organization admin whose access is a legacy admin team row with no bindings
    When they read the gateway logs, budgets, cache rules or the audit log
    Then the reads are allowed
    But managing the organization is still refused
    And the same reads are refused once the legacy row is gone

  @regression
  Scenario: A legacy member team row keeps read access and no delete
    Given a caller whose access is a legacy member team row with no bindings
    When they read the gateway logs or the audit log
    Then the reads are allowed
    But deleting a gateway budget is refused

  @regression
  Scenario: A legacy viewer team row keeps the audit log readable
    Given a caller whose access is a legacy viewer team row with no bindings
    When they read the audit log
    Then the read is allowed
    But deleting a gateway budget is refused

  @regression
  Scenario: A binding on the scope chain retires the legacy fallback
    Given a caller with a viewer binding on the project's team and a legacy admin row
    When a permission only the admin row would carry is checked
    Then the check is denied

  # ==========================================================================
  # Carrying the verdict into a request
  # ==========================================================================

  Scenario: An unauthenticated caller is refused before any scope id is read
    Given a request with no session
    When a declared permission check runs
    Then the request is refused without a decision being asked for

  Scenario: A permitted decision carries the organization role onto the request
    Given a decision naming the caller's organization role
    When the declared check passes
    Then the role is on the request context for the resolver behind it
    And a decision naming no role leaves the context's role unset

  Scenario: A denied request is never marked as checked
    Given a decision refusing the caller
    When the declared check runs
    Then the request is refused and never marked as checked
