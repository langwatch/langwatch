# See dev/docs/adr/124-an-organization-brings-its-own-identity-provider.md
Feature: Organization authentication settings
  As an organization administrator
  I want the sign-in connection, provisioning tokens and joining policy together
  So that I can configure access and understand refusals before changing it

  Background:
    Given an organization "acme" whose administrator "ana" may manage it
    And "sam" is a member of "acme"

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
    Scenario: A connection that is on but carrying nobody says both
      When "ana" opens the authentication page
      Then the sign-on card says who the connection routes as well as whether
      it is on
      And neither of the two ever stands in for the other

    @integration
    Scenario: Verifying a domain is answerable from here
      When "ana" reads the domains on the authentication page
      Then each one says whether it is proved or still waiting on her
      And she is offered the way to prove another
      And an organization that has claimed none is told so rather than shown
      an empty panel
      And a reader who may not see single sign-on is told who can tell them,
      rather than shown a failure

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

    @integration @unimplemented
    Scenario: A domain is proved in one place, and the policy points at it
      When "ana" reads the who-can-join policy
      Then she is told which of her domains are proved
      And she is offered the way to the connection that proves them
      And no second proof flow is drawn beside the policy
