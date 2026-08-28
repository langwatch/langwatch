Feature: Delegated governance viewer reaches the Governance pages
  As a security analyst holding a delegated read grant
  I want the Governance pages to open for whoever the Governance menu is offered to
  So that I read the parts of the surface I hold and am told which grant the rest needs

  The product switcher and the legacy Govern menu offer Governance on
  `governance:view`. The routers under `ee/governance/routers/` read on
  `<resource>:view` and write on `<resource>:manage`. The page guards used to
  ask for `organization:manage` instead, which is disjoint from
  `governance:view` in the RBAC hierarchy, so a delegated viewer was offered a
  menu entry that every page behind it refused with "Access Restricted".

  Each page now guards on `governance:view` and each panel answers for its own
  access: a readable panel renders, a refused one names the missing grant, and
  a control whose write the server would refuse is not offered at all.

  Background:
    Given organization "acme" has the AI governance feature flag on
    And alice is an org ADMIN of "acme"
    And sam holds a delegated role granting `governance:view` and nothing else

  @unit @rbac
  Scenario: Widening the page guard locks nobody out
    # governance:view and organization:manage are disjoint under the hierarchy
    # rule, so swapping one for the other is not a pure widening. It is safe
    # only while every built-in role that holds organization:manage also holds
    # governance:view.
    When each built-in organization role and team role is checked
    Then every role that holds `organization:manage` also holds `governance:view`

  @unit @rbac
  Scenario: A governance read grant does not imply organization management
    When the permission hierarchy is asked whether `governance:view` grants `organization:manage`
    Then it answers no
    And it also answers no in the other direction

  @integration @rbac
  Scenario: Every Governance page opens for a governance:view holder
    Given sam opens each page the Governance section navigation lists
    Then no page answers with "Access Restricted"

  @integration @rbac
  Scenario: The overview names the grant a refused panel needs
    Given sam opens the governance overview
    Then the spend and activity panel names `activityMonitor:view`
    And the rest of the page still renders

  @integration @rbac
  Scenario: A panel query is not sent when the viewer cannot read it
    Given sam opens the governance overview
    Then no request is made for the activity monitor

  @integration @rbac
  Scenario: Departments offers no controls a viewer cannot use
    Given sam opens the departments page
    Then there is no control to create a department
    And no department row offers an actions menu
    And the page names `governance:manage` as the grant those need

  @integration @rbac
  Scenario: Anomaly rules offers no controls a viewer cannot use
    Given sam holds `anomalyRules:view` and not `anomalyRules:manage`
    When sam opens the anomaly rules page
    Then there is no control to add a rule
    And no rule row offers an edit or archive control

  @integration @rbac
  Scenario: The sources tab offers no controls a viewer cannot use
    Given sam holds `ingestionSources:view` and not `ingestionSources:manage`
    When sam opens the inventory page (whose default tab for sam is
      Sources — sam holds no `aiTools:manage`)
    Then there is no control to add a source
    And no source row offers an edit, rotate, or archive control

  @integration @rbac
  Scenario: The inventory Catalog pane names its own grant
    Given sam opens the inventory page at its Catalog tab
    Then the pane names `aiTools:manage`
    And no tiles editor is rendered

  @regression @rbac
  Scenario: An org admin still sees every panel on the overview
    # The panels were re-grouped so a delegated viewer gets the part they
    # hold. The admin path must be unchanged by that.
    Given alice opens the governance overview
    Then every panel renders
    And every panel's read is issued
    And no panel names a missing grant

  @regression @rbac
  Scenario: An org admin still sees the department write controls
    Given alice opens the departments page
    Then the control to create a department is offered
    And no panel names a missing grant

  @regression @rbac
  Scenario: A principal who manages the organization but cannot read governance is refused
    # No built-in role produces this combination, which the @unit scenario
    # above pins. A custom role could, and the answer is the same refusal the
    # routers already give it.
    Given a principal holds `organization:manage` and not `governance:view`
    When they open the governance overview
    Then they are shown "Access Restricted"

  @regression @rbac
  Scenario: Routing policies opens on the grant its router asks for
    # This page is reached from the Gateway section navigation, which is
    # offered on virtualKeys:view. A team member holding routingPolicies:view
    # could call the router directly but was refused the page.
    Given dana is a team MEMBER of "acme" holding `routingPolicies:view`
    When dana opens the routing policies page
    Then the page renders the policy list
    And there is no control to add or edit a policy
    And the page names `routingPolicies:manage` as the grant those need
