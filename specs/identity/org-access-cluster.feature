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
  #   Organization
  #     ├ … API Keys, Audit Log, and beside them:
  #     └ Authentication ─── how everyone signs in, and how accounts arrive —
  #                          the organization's own control, so it sits with
  #                          the organization's keys and its audit trail
  #   People & access
  #     ├ Directory ──────── status first, then people · teams & projects ·
  #     │    │               groups · provisioning, and the rules by which
  #     │    │               somebody becomes a member
  #     │    └ one person ── a URL-routed drawer: how they sign in, why they
  #     │                    are here, what they can reach, what to do
  #     └ Roles ──────────── roles · role assignments
  #
  # ONE PAGE FOR "WHO IS HERE". Members, Teams & Projects and Access were
  # three navigation entries answering one question in three vocabularies: a
  # list of people, a list of the containers those people sit in, and the
  # rules by which a person becomes one of them. An administrator asking "who
  # is in my organization and how did they get here" had to visit all three
  # and hold the answer in their head. They are the Directory now — the page
  # already named after who exists — and the three old addresses forward onto
  # the tab each became.
  #
  # AUTHENTICATION IS THE OTHER HALF. Directory answers who is here;
  # Authentication answers how anybody gets in. There are three ways in — an
  # identity provider, an invitation, and a domain that admits people without
  # one — and all three are now asked on the one page, beside each other,
  # because they interact: automatic joining reads the domains the connection
  # proved, and an identity provider that asserts a factor at sign-in already
  # satisfies the second-factor requirement. Neither of those was ever on
  # screen with the thing it depends on.
  #
  # A domain is proved in exactly one place — the connection that rests on it —
  # and the join policy sits beside that connection rather than drawing a
  # second proof flow of its own.
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

  # ── The people area, on Directory ───────────────────────────────────────

  # THREE CUTS OF ONE LIST, NOT THREE LISTS. A member, somebody invited and
  # somebody asking to join are the same person at three distances from the
  # door, and they were three tabs so that each could carry a count. Chips
  # carry the count just as well and keep everybody in one table, which is
  # what makes "who is here" a single read — and it frees the tab bar for the
  # things that genuinely are different subjects: teams, groups, provisioning.

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

  # FOUR TABS, EACH A DIFFERENT SUBJECT. People, the containers people sit
  # in, the groups a provider sends, and the credential it sends them with.
  # They share one table treatment, one place for the tab's own action, and
  # one heading rhythm, so moving between them is a change of subject rather
  # than a change of product.

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

  # A COUNT IS THE ONE ANSWER NOBODY CAN CHECK. The band says the directory
  # manages twelve people, and an administrator asking whether the sync is
  # right is asking about a PERSON: did Sam come through Okta, is Ana still
  # managed, why is this contractor here. A number cannot be wrong in a way you
  # can see. So the page names them.

  Rule: the people the directory manages are named, not only counted

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

  # AN EMPTY SCREEN IS AN INVITATION TO ACT. An organization with no connection
  # was told three times that nothing was set up and offered nowhere to go.

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

  # ── Authentication ─────────────────────────────────────────────────────

  # ONE PAGE, TWO MODES, AND THE MODE IS THE CONNECTION'S. Before a connection
  # is live there is nothing to overview: what an administrator needs is the
  # setup journey, and that is the whole page. Once it is live the question
  # changes from "how do I set this up" to "is it working", which is two cards
  # and a glance: how everyone signs in, and how their accounts arrive. The
  # journey does not go away — domains are claimed later and break-glass
  # grants expire — it moves one quiet control behind the overview, on the
  # same page and at the same address.

  Rule: a live connection is read rather than configured

    @integration
    Scenario: The overview names the connection by the protocol it speaks
      Given "acme" has a live OpenID Connect connection to "okta"
      When "ana" opens the authentication page
      Then the sign-on card is titled for OpenID Connect
      And it names "okta" as the identity provider
      And where the connection stands is said in words, never as a state name

    @integration
    Scenario: A domain whose record has gone says so on the overview
      Given "acme" proved "acme.com" and its published record has been missing
      for two days
      When "ana" opens the authentication page
      Then "acme.com" is listed as missing its record rather than as proved

    @integration
    Scenario: The overview offers only what the connection really has
      Given "acme" has a live OpenID Connect connection
      When "ana" opens the authentication page
      Then she is offered a test sign-in through that connection
      And no service provider metadata is offered, since only SAML publishes it
      And no signing certificate expiry is shown, since none is read from it

    @unit
    Scenario: Every state a connection can be in has customer words
      When each state a connection can rest in is put to the status chip
      Then each one answers with words a customer reads
      And none of them is the state's own name

  Rule: how accounts arrive is on the same page as how people sign in

    @integration
    Scenario: The directory card carries the organization's real numbers
      Given "acme" has a directory that manages three of its four members
      When "ana" opens the authentication page
      Then the directory card says three of four
      And it says the fourth arrived another way
      And it offers the way to the provisioned members

    @integration
    Scenario: A reader who may not read membership is told so
      Given "ana" may see single sign-on but may not manage the organization
      When she opens the authentication page
      Then the counts she may not read say so rather than reading zero

    @unit
    Scenario: One source that stopped is never summarised as working
      Given one source is syncing and another needs attention
      When the sources are summarised into one chip
      Then the chip does not say everything is working

  # A token is bound to one connection and can only touch the people that
  # connection provisioned. Bound to one that does not route, it authenticates
  # perfectly and provisions nobody -- and the administrator learns that at the
  # provider, days later, rather than here where the choice was made.
  Rule: a provisioning token is only offered the connections that could carry it

    @integration
    Scenario: Only live connections are offered when issuing a provisioning token
      Given "acme" has a live connection and one that was never turned on
      When "ana" goes to issue a provisioning token
      Then only the live connection is offered to bind it to

    @integration
    Scenario: An organization with nothing live says so rather than offering an empty choice
      Given "acme" has no connection that is live
      When "ana" goes to issue a provisioning token
      Then she is told no connection is live yet
      And issuing is not offered until one is

    @integration
    Scenario: A token issued against a connection since retired still names it
      Given "acme" holds a token issued against a connection that has been torn down
      When "ana" reads the provisioning tokens
      Then the token still names the connection it was issued against

  Rule: setting up and checking are two modes of one page

    @integration
    Scenario: An organization with no connection gets the journey
      Given "acme" has never registered an identity provider
      When "ana" opens the authentication page
      Then she is offered the first step of setting one up

    @integration
    Scenario: Managing a live connection stays on the same page
      Given "acme" has a live connection
      When "ana" opens the authentication page and chooses to manage it
      Then the setup journey is on the same page
      And she can go back to the overview

    @integration
    Scenario: The page points at where the reader's own sign-in lives
      Given "acme" has a live connection
      When "ana" opens the authentication page
      Then it says her own passkeys and linked accounts are on her profile

  # A REFUSAL IS NOT A SCREEN. An organization that cannot set single sign-on
  # up — an unlicensed installation, one that has not restarted since its
  # licence was activated, an organization not switched on for it — still came
  # to find out how its people sign in. A page whose whole content is "you
  # cannot use this" answers nothing, teaches nothing, and turns a navigation
  # entry into a wall.

  Rule: an organization that cannot set it up still reads the page

    @integration
    Scenario: The reason sits above the page rather than replacing it
      Given "acme" is not switched on for setting single sign-on up itself
      When "ana" opens the authentication page
      Then she is told why she cannot start and what would change it
      And the page still explains what single sign-on would give "acme"
      And her directory's own facts are still on it
      And her own sign-in methods are still pointed at

    @integration
    Scenario: Nothing is offered that would be refused
      Given "acme" is not switched on for setting single sign-on up itself
      When "ana" opens the authentication page
      Then no control for registering an identity provider is on it
      And no number is shown for a connection that does not exist

  # NO SESSION POLICY. Requiring single sign-on of every member, falling back
  # to a password, and how long a session lasts are not settings this
  # organization has. The page says nothing about them: a frame drawn around a
  # control that does not exist is a promise the product has not made, and a
  # disabled one is worse, because it reads as a thing somebody switched off.

  # ── The rules by which somebody gets in ────────────────────────────────

  # THESE WERE A PAGE CALLED ACCESS, WHICH NAMED NOTHING. "Access" is what
  # every page in this cluster is about, so a page carrying that word and two
  # switches told a reader nothing about which two. Both switches are
  # conditions of getting in, so both went to Authentication — beside the
  # connection they interact with, which is the thing neither of them was ever
  # on screen with.

  Rule: the three ways in are asked on one page

    @unit
    Scenario: The old access address forwards onto the page it became
      When somebody opens the old access address
      Then they are taken to the directory page

    @integration
    Scenario: Who may join is asked beside the connection whose domains it reads
      When "ana" opens the authentication page
      Then the who-may-join policy is on it
      And it is not on the directory page

    @integration
    Scenario: The second-factor requirement is asked with the sign-in it guards
      When "ana" opens the authentication page
      Then the second-factor requirement is on it
      And it is not on the directory page

    @integration
    Scenario: The rules are not on the page about the people they admit
      When "ana" opens the directory page
      Then the who-may-join policy is not on it
      And the second-factor requirement is not on it

  Rule: opening the door is a paid control and closing it is not

    @integration
    Scenario: Opening the door needs the plan that carries it
      Given "acme" is not on the Enterprise plan
      When "ana" opens the authentication page
      Then the who-may-join setting is on screen, greyed, with the reason on it
      And she is offered the way to the plan that carries it

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
      Then it says a verified domain is what lets colleagues join automatically
      And it says asking to join needs only one member with a verified address,
      because "ana" approves each request herself

    @integration
    Scenario: A domain is proved in one place, and the policy points at it
      When "ana" reads the who-can-join policy
      Then she is told which of her domains are proved
      And she is offered the way to the connection that proves them
      And no second proof flow is drawn beside the policy
