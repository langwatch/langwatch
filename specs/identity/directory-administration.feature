# See dev/docs/adr/122-scim-reconciliation-is-a-visible-surface.md
Feature: Directory administration
  As an organization administrator
  I want members, invitations, join requests and provisioning in one directory
  So that I can see who has access and how they arrived

  Background:
    Given an organization "acme" whose administrator "ana" may manage it
    And "sam" is a member of "acme"

  Rule: people, invitations and requests are three cuts of one list

    @integration
    Scenario: The directory's people tab opens on everybody
      When "ana" opens the directory page
      Then she sees the people tab open, listing members, invitations and
      requests together
      And the seat usage is on the page without being the subject of it

    @integration
    Scenario: A cut that is waiting on somebody says how many
      Given two invitations are outstanding and one colleague has asked to join
      When "ana" opens the directory page
      Then the invited chip carries the number two
      And the waiting-to-join chip carries the number one

    @integration
    Scenario: A cut with nobody in it says so rather than emptying the table
      Given nobody has asked to join
      When "ana" selects the waiting-to-join cut
      Then it says nobody is waiting
      And it offers nothing to approve

    @integration
    Scenario: The old members address forwards onto the tab it became
      When somebody opens the old members address
      Then they are taken to the directory page's people tab

    @integration
    Scenario: The old teams address forwards onto the tab it became
      When somebody opens the old teams and projects address
      Then they are taken to the directory page's teams and projects tab

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
      When "ana" reads where her identity provider sends people
      Then the copy names SCIM, for the administrator who searched for it
      And no page in the cluster is titled after the protocol, because the
      navigation is named for what a page holds

  Rule: the tabs are four subjects drawn one way

    @integration
    Scenario: Every tab puts its action in the same place
      When "ana" moves between the directory tabs
      Then each tab's own action sits at the end of that tab's first heading row
      And no two tabs draw that action differently

    @integration
    Scenario: A tab that names a count names it the same way as its siblings
      When "ana" opens the directory page
      Then every tab that carries a number carries it as a badge on the tab
      And a tab with nothing in it still carries its zero

    @integration
    Scenario: The tabs name the subjects this page owns
      When "ana" opens the directory page
      Then the people, the teams and the groups each have a tab
      And how the connector is set up is not among them, because that is about
      how people arrive rather than about who arrived

  Rule: the departments are reported on here and managed under Governance

    @integration
    Scenario: The departments tab joins only where there is anything to put on it
      Given "acme" has departments
      When "ana" opens the directory page
      Then a departments tab is offered, carrying how many there are
      And an organization with none is offered no such tab

    @integration
    Scenario: The departments tab references what Governance manages
      When "ana" opens the directory page at the departments
      Then the departments are what she is looking at

    @integration
    Scenario: A reader who may not view governance is offered no departments tab
      Given "ana" may manage the organization but may not view governance
      When she opens the directory page at an address naming the departments
      Then no departments tab is offered
      And she lands on the people rather than on a refusal

    @integration
    Scenario: A department says how much it holds, in its own words
      When "ana" reads the departments
      Then each one names the people, the teams and the projects it holds
      And a part it holds none of is left out rather than read out as a zero
      And a department holding nobody says so plainly

    @integration
    Scenario: The people no department holds are counted underneath
      When "ana" reads the departments
      Then the people no department holds are counted beneath them
      And no department is invented to hold them

    @integration
    Scenario: Assignment stays where it is managed
      When "ana" reads the departments
      Then she is offered the way to Governance, where they are assigned
      And nothing on this tab assigns anybody

  Rule: the people the directory manages are named, not only counted

    @integration
    Scenario: A member's department is readable at a glance
      When "ana" reads the people the directory manages
      Then a member a department holds carries its name beside their own
      And a member no department holds carries nothing rather than an empty
      label

    @integration
    Scenario: The directory's own people are listed by name
      Given "acme" has members its identity provider created
      When "ana" opens the directory page
      Then each of them is a row with their name, their address and the access
      they hold
      And each row says the directory is where they came from

    @integration
    Scenario: The people who arrived another way are not in that list
      Given "acme" has members its identity provider never created
      When "ana" opens the directory page
      Then they are not listed among the people the directory manages

    @integration
    Scenario: Somebody managed whose access is switched off is still listed
      Given the directory manages somebody whose access here is switched off
      When "ana" opens the directory page
      Then they are still a row, marked as switched off
      And an ordinary member is marked nothing at all

    @integration
    Scenario: A directory that has provisioned nobody says so honestly
      Given "acme" has members and its identity provider created none of them
      When "ana" opens the directory page
      Then she is told the directory has provisioned nobody yet
      And she is told those members arrived another way

    @integration
    Scenario: A roster that could not be read is not drawn as an empty one
      Given the read that says who the directory manages fails
      When "ana" opens the directory page
      Then she is told what could not be read, in words, with a trace to quote
      And nobody is listed as managed on the strength of the half that answered

    @integration
    Scenario: A reader who may not read membership is not shown a roster
      Given "ana" may see single sign-on but may not manage the organization
      When she opens the directory page
      Then no list of the people the directory manages is on it

  Rule: the state with no data carries the first step

    @integration
    Scenario: An organization with no connection is offered the way to set one up
      Given "acme" has never registered an identity provider
      When "ana" opens the directory page
      Then she is told no identity provider is connected
      And she is offered the way to the page that registers one

    @integration
    Scenario: The first step is not offered to somebody who would be refused it
      Given "ana" may see single sign-on but may not manage it
      When she opens the directory page with no connection registered
      Then no control for registering an identity provider is on it
      And she is told who does set it up
