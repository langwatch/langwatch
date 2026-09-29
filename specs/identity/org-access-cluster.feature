Feature: Roles and access assignments in one settings surface
  As an organization administrator
  I want role definitions and their assignments in one coherent place
  So that what somebody can reach is readable without translating engine terms

  # This is the PR1 role-consolidation slice from the combined identity source.
  # Directory, authentication and provisioning scenarios belong to their own
  # feature files; keeping them out here makes this file's contract honest.

  Background:
    Given an organization "acme" whose administrator "ana" may manage it
    And "sam" is a member of "acme"

  # ── Roles and their assignments ────────────────────────────────────────

  Rule: the definitions and the grants of them are one page
    @unit
    Scenario: The old role bindings address forwards onto the tab it became
      When somebody opens the old role bindings address
      Then they are taken to the roles page, on the assignments tab

    @integration
    Scenario: The screen says role assignment, never binding
      When "ana" opens the assignments tab
      Then every word on it is the industry's, not the engine's
      And no screen in the cluster shows the word "binding"

    @integration
    Scenario: A scope is named in full
      Given "sam" holds a role on a team called "Platform"
      When "ana" opens the assignments tab
      Then the scope reads "Team Platform" rather than an abbreviation

    @integration
    Scenario: Reading the assignments does not depend on a second answer
      Given the assignments fail to load
      When "ana" opens the assignments tab
      Then she is told what failed, in words, with a trace to quote

  # An organization of any size has hundreds of assignments: the same person,
  # the same role, once per team. Drawn one per row that is a wall of chips
  # nobody can count, and the counting is the whole job of the screen.

  Rule: the assignments are gathered onto whoever holds them

    @integration
    Scenario: One row per holder, however many grants they have
      Given "sam" holds the same role on the organization and on three teams
      When "ana" opens the assignments tab
      Then "sam" is one row, not four
      And the count above the list says one member or group

    @integration
    Scenario: Identical grants are summarised rather than repeated
      Given "sam" holds the same role on the organization and on three teams
      When "ana" opens the assignments tab
      Then the row says the role applies to the organization and three teams
      And it does not name each team until she asks for them
      And asking shows every one of them, named in full

    @integration
    Scenario: Every holder is named, whatever kind of holder it is
      Given two API keys hold roles in "acme"
      When "ana" opens the assignments tab
      Then each key is its own row, under its own name
      And a key with no name of its own says so in a sentence
      And no row on the screen is nameless

    @integration
    Scenario: The scope filter carries the real numbers
      When "ana" opens the assignments tab
      Then All, Organization, Teams and Projects each carry how many
      assignments are behind them
      And those numbers do not change when she applies one of the filters

  # ── The roles themselves ───────────────────────────────────────────────

  Rule: a role card says what the role really grants

    @unit
    Scenario: A predefined role card describes the role it actually is
      When "ana" opens the roles tab
      Then Admin, Member and Viewer each carry a sentence in plain words
      And each sentence is true of the permissions that role holds
      And each card shows permission identifiers the role really grants
      And each card says how many permissions there are in total

    @integration
    Scenario: A predefined role card counts the people who hold it
      Given two people hold Admin, one of them through a group
      When "ana" opens the roles tab
      Then the Admin card says two people hold it
      And nobody is counted twice for holding it two ways
      And a count that could not be read says so rather than showing a zero

    @integration
    Scenario: A custom role card names who holds it and where
      Given "acme" has a custom role assigned on a project and through a group
      When "ana" opens the roles tab
      Then the card names the role, when it was written and what it grants
      And it names the project it is in force on
      And it names the people holding it, and the group they hold it through
      And a role nobody holds says so rather than showing an empty strip

    @integration
    Scenario: Every permission a role holds can be read in full
      When "ana" asks to see everything a role grants
      Then every permission is listed, grouped by the part of the product it
      is about
      And each one carries both its identifier and a sentence

    @integration
    Scenario: Reading the roles does not depend on a second answer
      Given the roles fail to load
      When "ana" opens the roles tab
      Then she is told what failed, in words, with a trace to quote

    @integration
    Scenario: Role changes are tied to the audit log that records them
      When "ana" opens the roles tab
      Then she is offered the audit log as the record of role changes
      And a reader who may not open the audit log is offered nothing

  # ── Writing a role ─────────────────────────────────────────────────────

  Rule: a role is written against a description of what it will do

    @integration
    Scenario: A role is built one part of the product at a time
      When "ana" starts a new role
      Then the permissions are grouped by the part of the product they are
      about, each with a sentence saying what it is
      And each one offers no access, read, or full access
      And the individual actions are there for a role that needs them
      And she can search the list by the name of a screen or a permission

    @unit
    Scenario: Picking an action that needs another brings it along
      Given "ana" is writing a role
      When she grants the ability to change something
      Then the ability to see it is granted with it
      And taking the ability to see it away takes the changes with it

    @unit
    Scenario: Every permission the picker offers is explained in words
      When "ana" reads the permission list
      Then every resource the engine knows carries a name and a sentence
      And no permission is offered with nothing but its identifier

    @integration
    Scenario: The preview describes the role as it is built
      When "ana" grants a role the ability to read traces
      Then the preview says the role can view traces
      And it counts the permissions and the areas they fall in
      And a role that grants nothing cannot be saved, and says why

    @integration
    Scenario: The preview says which permissions do nothing at that scope
      Given a role that grants something only the organization can grant
      When "ana" previews it assigned on a team
      Then that permission is shown apart, as granting nothing there
      And she is told it takes effect only on the organization
