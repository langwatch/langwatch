Feature: Signing in from the identity provider's own portal through a SAML connection
  As an organization administrator whose people start from their identity provider's app portal
  I need LangWatch to accept a SAML response it did not ask for, on the connections I choose
  So that a tile in the portal signs my people in and lands them where I said it may

  # A response LangWatch asked for answers a request it sent (InResponseTo). One the identity
  # provider started answers nothing, so the connection's opt-in is what admits it, and the
  # landing page comes only from the connection's own list. Every other check is the same one a
  # sign-in LangWatch started passes (ruling: Alex, 2026-10-09; support, with a RelayState allow-list).

  Background:
    Given an organization "acme" with an active SAML connection "acme-okta"
    And "ana" is an administrator who may edit "acme-okta"

  Rule: each connection opts in on its own, and only its editors decide

    @integration @unimplemented
    Scenario: An administrator opts a connection in and lists where a sign-in may land
      When "ana" saves "acme-okta" with sign-in from the identity provider allowed
      And lists "/acme/messages" and "/settings" as allowed landing pages
      Then "acme-okta" admits responses it did not ask for
      And the identity provider settings form shows the opt-in and both landing pages

    @integration
    Scenario: A connection is not opted in until somebody opts it in
      Given "acme-okta" was registered before this setting existed
      Then "acme-okta" does not admit responses it did not ask for
      And it lists no landing pages

    @integration @unimplemented
    Scenario: Somebody who may not edit the connection cannot change the opt-in
      Given "bob" is a member of "acme" without permission to edit its single sign-on connections
      When "bob" tries to opt "acme-okta" in
      Then the request is refused before anything is saved

    @unit
    Scenario: A landing page must be a path on LangWatch itself
      Then each of these is refused as a landing page
        | entry                     |
        | https://elsewhere.example |
        | //elsewhere.example/acme  |
        | /\elsewhere.example       |
        | /acme%2Fmessages          |
        | javascript:alert(1)       |
        | acme/messages             |
        | /acme//messages           |
        | /acme/../admin            |
        | /./acme                   |
        | /acme?next=https://elsewhere.example |
      And "/acme/messages?tab=all" is accepted as a landing page

  Rule: a response nobody asked for signs in only through an opted-in connection

    @integration
    Scenario: An unsolicited response for an opted-in connection signs the person in
      Given "acme-okta" is opted in
      When the identity provider posts a valid signed response for "carol@acme.com" that answers no request
      Then "carol@acme.com" is signed in through "acme-okta"
      And the session records the same sign-in method as one LangWatch started

    @integration
    Scenario: An unsolicited response for a connection not opted in is refused
      Given "acme-okta" is not opted in
      When the identity provider posts a valid signed response that answers no request
      Then nobody is signed in
      And the log names "acme-okta" and the refusal as a response nobody asked for
      And the person sees the sign-in error screen without the reason

    @integration
    Scenario: An unsolicited response with nobody signed in signs the person in
      Given "acme-okta" is opted in
      And the browser holds no session
      When the identity provider posts a valid signed response for "carol@acme.com" that answers no request
      Then "carol@acme.com" is signed in through "acme-okta"

    @integration
    Scenario: A sign-in LangWatch started is unaffected by the opt-in
      Given "acme-okta" is not opted in
      When "carol@acme.com" starts single sign-on from LangWatch and the provider answers that request
      Then "carol@acme.com" is signed in through "acme-okta"

  Rule: the landing page is a listed one, or the default home

    @unit
    Scenario: A listed RelayState is where the person lands
      Given "acme-okta" lists "/acme/messages"
      When an unsolicited response arrives with RelayState "/acme/messages"
      Then the person lands on "/acme/messages"

    @unit
    Scenario: No RelayState lands on the default home
      When an unsolicited response arrives without a RelayState
      Then the person lands on the default home

    @unit
    Scenario: A full address on LangWatch's own origin lands on its listed path
      Given "acme-okta" lists "/acme/messages"
      When an unsolicited response arrives with RelayState "<LangWatch origin>/acme/messages"
      Then the person lands on "/acme/messages"

    @unit
    Scenario Outline: A RelayState not on the list lands on the default home
      Given "acme-okta" lists "/acme/messages"
      When an unsolicited response arrives with RelayState "<relay state>"
      Then the person lands on the default home

      Examples:
        | relay state                              |
        | https://elsewhere.example/acme/messages  |
        | //elsewhere.example/acme/messages        |
        | /\elsewhere.example/acme/messages        |
        | /acme%2Fmessages                         |
        | %2Facme%2Fmessages                       |
        | /acme/messages/../../elsewhere           |
        | /acme/messages-and-more                  |
        | /settings                                |
        | javascript:alert(1)                      |

  Rule: every other check applies exactly as for a sign-in LangWatch started

    @integration
    Scenario: A replayed assertion is refused
      Given "acme-okta" is opted in
      And an unsolicited response for "carol@acme.com" has already signed her in
      When the same assertion is posted again while it is still within its validity
      Then nobody is signed in by the second post
      And the log names the refusal as a replayed assertion

    @integration
    Scenario Outline: An unsolicited response that fails a response check is refused
      Given "acme-okta" is opted in
      When the identity provider posts an unsolicited response whose <check> is wrong
      Then nobody is signed in
      And the refusal is the same one a sign-in LangWatch started gets for that check

      Examples:
        | check                                            |
        | audience                                         |
        | recipient                                        |
        | destination                                      |
        | signature                                        |
        | expiry, beyond the allowed clock difference      |

  Rule: a response nobody asked for never changes who the browser is signed in as

    @integration
    Scenario: An unsolicited response for another person is refused while somebody is signed in
      Given "acme-okta" is opted in
      And the browser is signed in as "carol@acme.com"
      When the identity provider posts a valid signed response for "dave@acme.com" that answers no request
      Then the person sees the sign-in error screen asking them to sign out first
      And the browser is still signed in as "carol@acme.com" with the same session
      And no session is created for "dave@acme.com"
      And the log names "acme-okta" and the refusal, and holds nothing from the assertion

    @integration
    Scenario: An unsolicited response for the person already signed in signs them in
      Given "acme-okta" is opted in
      And the browser is signed in as "carol@acme.com"
      When the identity provider posts a valid signed response for "carol@acme.com" that answers no request
      Then "carol@acme.com" is signed in through "acme-okta"

  Rule: a response nobody asked for, posted from another site, is posted again from LangWatch first

    # A post from the identity provider's page arrives without LangWatch's cookies; posting it
    # again from LangWatch carries them, so the rule above applies to it.

    @integration
    Scenario: An unsolicited response posted from another site is posted again once from LangWatch
      Given "acme-okta" is opted in
      When the identity provider's page posts a valid signed response for "carol@acme.com" that answers no request
      Then the browser gets a page that posts the same response to the same address from LangWatch
      And that page sets no cookie and runs no script but its own
      And the assertion is not yet used
      When the browser posts it from LangWatch
      Then "carol@acme.com" is signed in through "acme-okta" and the response is not posted again

    @integration
    Scenario: The response posted again from LangWatch is refused for another person while somebody is signed in
      Given "acme-okta" is opted in
      And the browser is signed in as "carol@acme.com"
      When the identity provider's page posts a valid signed response for "dave@acme.com" that answers no request
      And the browser posts it again from LangWatch with its session
      Then the person sees the sign-in error screen asking them to sign out first
      And the browser is still signed in as "carol@acme.com" with the same session

    @integration
    Scenario: A response to a sign-in LangWatch started is never posted again
      Given "acme-okta" is opted in
      When "carol@acme.com" starts single sign-on from LangWatch and the identity provider's page posts the answer
      Then "carol@acme.com" is signed in through "acme-okta" without a page in between
