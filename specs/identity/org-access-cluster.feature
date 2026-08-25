Feature: The people and access settings, as one cluster
  As the administrator of an organization
  I want the people, the roles they hold and the rules they are held to in
  one coherent set of screens
  So that "who is here, why, and what can they reach" is a question with one
  answer instead of six pages that each know part of it

  # D05 / D11 / D12, ADR-092 for the engine underneath and ADR-117 for
  # joining. The access cluster was six navigation entries that had grown one
  # at a time: a members page that was also the second-factor page and also
  # the domain-policy page, a Role Bindings page a navigation entry away from
  # the Roles it listed, and a SCIM page named after a protocol.
  #
  #   You
  #     ├ Profile ────────── the reader's own name and photo
  #     └ Security ───────── how the reader proves who they are: their
  #                          addresses, their passkeys, their second step
  #                          and their password
  #   People & access
  #     ├ Members ────────── members · invitations (n) · join requests (n)
  #     │    └ one person ── a URL-routed drawer: how they sign in, why they
  #     │                    are here, what they can reach, what to do
  #     ├ Teams & Projects ─ the teams, and the projects each holds
  #     ├ Roles ──────────── roles · role assignments
  #     ├ Single Sign-On ─── the connection, its domains and who proved them
  #     ├ Directory ─────── status first, then groups, then tokens
  #     ├ Access ─────────── who may join, and the second-factor requirement
  #     └ Audit Log ──────── what was done in the organization, and by whom
  #
  # TWO SECTIONS, AND THE FIRST IS THE READER'S. How you prove who you are is
  # not an organization setting, and it was filed as one: the page sat between
  # the roles of other people and the domains an administrator proved, which
  # is the wrong neighbourhood for the one page in Settings a member with no
  # authority at all can still act on. It is Security now, under You, beside
  # the reader's own name and photo. What an ORGANIZATION requires of everyone
  # who signs in stays where it belongs, on Access.
  #
  # GROUPS ARE THE DIRECTORY'S SUBJECT. A group is the thing an identity
  # provider sends and the thing an administrator grants a role to, and it had
  # a navigation entry of its own a click away from the page that reports
  # whether the directory sent it. They are one page: Directory leads with
  # whether sync is working, and its Groups tab is where every group is
  # managed, the directory's and the hand-made ones alike.
  #
  # VOCABULARY. The engine binds roles to principals at scopes and goes on
  # saying so. Every screen says ROLE ASSIGNMENT, assigned to a member or a
  # group, ON the organization, a team or a project. The word "binding" is
  # not a customer's word and does not appear where one can read it.
  #
  # PROVENANCE. Every person carries the reason they are here — invited,
  # admitted by a domain, or created by the directory — and somebody we
  # cannot explain carries no chip at all rather than a fourth, invented one.

  Background:
    Given an organization "acme" whose administrator "ana" may manage it
    And "sam" is a member of "acme"

  # ── The members area ───────────────────────────────────────────────────

  Rule: people, invitations and requests are three tabs of one page

    @integration
    Scenario: The members page opens on the people who are here
      When "ana" opens the members page
      Then she sees the members, the invitations and the join requests as tabs
      And the members tab is the one open
      And the seat usage is on the page without being the subject of it

    @integration
    Scenario: A tab that is waiting on somebody says how many
      Given two invitations are outstanding and one colleague has asked to join
      When "ana" opens the members page
      Then the invitations tab carries the number two
      And the join requests tab carries the number one

    @integration
    Scenario: An empty tab says it is empty
      Given nobody has asked to join
      When "ana" opens the join requests tab
      Then it says nobody is waiting
      And it offers nothing to approve

    @integration
    Scenario: The rules about people are not on the page about people
      When "ana" opens the members page
      Then the second-factor requirement is not on it
      And the who-can-join policy is not on it
      And both are on the access page instead

  Rule: everybody who is listed is listed the same way

    @integration
    Scenario: One identity row carries a person wherever they appear
      When "ana" opens the members page
      Then each person shows their name, their address and why they are here
      And an invited person shows the same row, marked as invited
      And somebody waiting to join shows the same row, with the domain matched

    @integration
    Scenario: A member the directory owns says so
      Given "sam" was created by "acme"'s identity provider
      When "ana" opens the members page
      Then "sam" carries a chip naming the directory as the reason he is here

    @integration
    Scenario: A member who walked in on the domain policy says nobody approved
      Given "sam" joined "acme" automatically on a matching domain
      When "ana" opens the members page
      Then "sam" carries a chip naming the domain
      And it says that nobody approved it

    @integration
    Scenario: A member we cannot explain carries no chip rather than a guess
      Given "ana" created "acme" herself
      When "ana" opens the members page
      Then no chip claims a reason she is here

    @unit
    Scenario: The reason somebody is here is asked for separately
      Given the read that explains each member fails
      When "ana" opens the members page
      Then she still sees every member
      And she is told only that the reasons could not be worked out

  # ── One person ─────────────────────────────────────────────────────────

  Rule: a person is an address, not a dialog

    @integration
    Scenario: Opening a person puts them in the address bar
      When "ana" opens "sam" from the members list
      Then the address names the person drawer and "sam"
      And pasting that address opens the same drawer on the same person

    @integration
    Scenario: The drawer answers who, what and what next
      When "ana" opens "sam"
      Then she sees the address he signs in with and whether he proved it
      And she sees whether he can prove a second factor
      And she sees why he is a member
      And she sees his organization role, his role assignments and his groups
      And she is offered his seat and his membership, and nothing else

    @integration
    Scenario: Signing in as somebody is not offered here
      When "ana" opens "sam"
      Then nothing on the drawer offers to sign in as him

    @integration
    Scenario: An administrator cannot change their own organization role
      When "ana" opens herself
      Then the role picker is replaced by the reason it is not offered

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

  # ── Groups, on the Directory page ───────────────────────────────────────

  Rule: every group is managed where the directory reports on them

    @unit
    Scenario: The old groups address forwards onto the tab it became
      When somebody opens the old groups address
      Then they are taken to the directory page, on the groups tab

    @integration
    Scenario: The groups tab holds the hand-made ones as well as the sent ones
      Given "acme" has a group its identity provider sends and one made by hand
      When "ana" opens the groups tab of the directory page
      Then she sees both
      And she is offered the way to add another

    @integration
    Scenario: A directory group is marked in the list
      Given "acme" has a group its identity provider sends
      When "ana" opens the groups tab of the directory page
      Then that group carries a chip naming the directory

    @integration
    Scenario: The groups the directory sent say what they grant
      When "ana" opens the groups tab of the directory page
      Then each group from the directory names the roles it carries
      And a group that grants nothing says so rather than showing a blank

    @integration
    Scenario: A directory group says why its membership cannot be edited
      When "ana" opens a group its identity provider sends
      Then she is told the provider owns who is in it
      And she is told what this group grants is still hers to change
      And nothing offers her a control that would be undone on the next push

  # ── Directory ──────────────────────────────────────────────────────────

  Rule: the status is the first thing on the page

    @unit
    Scenario: The old directory sync address forwards onto the page it became
      When somebody opens the old directory sync address
      Then they are taken to the directory page

    @integration
    Scenario: The page leads with whether it is working
      When "ana" opens the directory page
      Then the first thing she reads is which sources are connected
      And when it last pushed, how many people it manages, and how many groups
      it sent
      And the status stands above the tabs, so every tab is read against it

    @integration
    Scenario: The people the directory did not put here are counted too
      Given "acme" has members its identity provider never created
      When "ana" opens the directory page
      Then she is told how many of her members the directory does not manage
      And she is told that removing them from the directory will not remove
      them here

    @integration
    Scenario: A reader who may not read groups is told nothing they cannot have
      Given "ana" may see single sign-on but may not manage the organization
      When she opens the directory page
      Then the groups it sent and the members it does not manage read as
      unavailable rather than as zero
      And no groups tab is offered

    @integration
    Scenario: The protocol keeps its name in the body copy
      When "ana" opens the directory page
      Then the navigation entry says "Directory"
      And the page still says SCIM, for the administrator who searched for it

  # ── Access ─────────────────────────────────────────────────────────────

  Rule: opening the door is a paid control and closing it is not

    @integration
    Scenario: Opening the door needs the plan that carries it
      Given "acme" is not on the Enterprise plan
      When "ana" opens the access page
      Then both open settings are on screen, greyed, with the reason on them
      And she is offered the way to the plan that carries them

    @unit
    Scenario: The refusal holds at the boundary, not only on the screen
      Given "acme" is not on the Enterprise plan
      When something asks to open "acme" to colleagues who request it
      Then the attempt is refused with code join_policy_not_licensed
      And nothing about the setting was written

    @unit
    Scenario: Closing the door is never refused for the plan
      Given "acme" opened its door under a plan it has since left
      When "ana" closes it
      Then the setting saves
      And the plan was never consulted

    @integration
    Scenario: The two ways a domain matters are told apart
      When "ana" reads the who-can-join policy
      Then it says two members must have verified an address for a domain to
      admit people
      And it says that is not the same as proving a domain for single sign-on

    @integration
    Scenario: Verifying a domain is answerable from here
      When "ana" opens the access page
      Then she sees which domains have been proved and which have not
      And she is offered the way to prove one
