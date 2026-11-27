Feature: A sign-in the company's identity provider refused says who refused it
  As somebody whose company sign-in turned them away
  I need to know it was my company's sign-in, not LangWatch, and what happens next
  So that I ask the right person instead of thinking LangWatch blocked me

  # An identity provider answers `access_denied` when its administrator has not assigned the
  # person to the LangWatch app, or when the person cancels. The callback carrying it is
  # unsigned: anybody can open it with any query string. So the screen never names an
  # organization or a person, and the only address the door trusts is the one carried in a
  # signed, short-lived, httpOnly cookie set when the sign-in started on our own page.
  # Seat requests and the waiting screen behind them: modules/organization/specs/seat-requests.feature.

  Background:
    Given an organization with a single sign-on connection to Okta on a verified domain

  @unit
  Scenario: A refused person the organization would hold for a seat sees the seat-limit screen first
    Given the person typed their work address on the sign-in page before going to Okta
    And the organization has no seat free for them
    When Okta refuses the sign-in with "access_denied"
    Then the person is sent to the sign-in error screen with the code "seat_limit_reached"
    And the organization is told about the refused sign-in for that address with the provider kind
    And the screen says the organization is over its seat limits and to contact an administrator to approve the access

  @unit
  Scenario: A refused person at an organization with seats free is told the provider refused
    Given the person typed their work address on the sign-in page before going to Okta
    And the organization has a seat free for them
    When Okta refuses the sign-in with "access_denied"
    Then the person is sent to the sign-in error screen with the code "access_denied" and the kind "okta"
    And the screen says their company sign-in (Okta) refused it, not LangWatch
    And it tells them to ask their IT team to assign them the LangWatch app in Okta

  @unit
  Scenario: A provider of a kind we do not name is called the company's sign-in
    Given a connection whose issuer is not a provider we recognise
    When it refuses a sign-in with "access_denied"
    Then the redirect carries the protocol kind, which the screen does not name
    And the screen says their company's sign-in refused it, not LangWatch

  @unit
  Scenario: Without a known address nobody is told and no seat is requested
    Given the person reached the provider without typing an address on our sign-in page
    When the provider refuses the sign-in with "access_denied"
    Then the organization is not told about the refusal
    And the person is sent the refusal naming the provider kind

  @unit
  Scenario: An address outside the connection's verified domains is not recorded
    Given the person typed an address on a domain the connection has not proved
    When the provider refuses the sign-in with "access_denied"
    Then the organization is not told about the refusal

  @unit
  Scenario: A forged or tampered hint cookie is ignored
    Given the hint cookie was altered, signed with another key, or has expired
    When the provider refuses the sign-in with "access_denied"
    Then the door treats the address as unknown

  @unit
  Scenario: A hint for another provider is ignored
    Given the hint cookie was set for a sign-in with a different provider
    When this provider refuses the sign-in with "access_denied"
    Then the door treats the address as unknown

  @unit
  Scenario: The hint is set when a sign-in starts and dropped once the callback answers
    Given the person starts a sign-in with a provider from our sign-in page with their address
    Then the answer sets a signed, httpOnly hint cookie scoped to /api/auth that lives for an hour
    And a refused callback trusts it to name the person for 15 minutes only
    And the hint holds a hash of the state or RelayState the answer sends the person to the provider with
    And an answer that carries neither sets no hint
    And over https it is SameSite=None and Secure, so a SAML provider's cross-site post carries it
    And when the provider's callback answers or any answer starts a session, the hint cookie is cleared

  @unit
  Scenario: A sign-in that never came back is noticed on the next visit
    Given the person started a sign-in with their company's connection from our sign-in page, with or without an address
    And the provider never sent them back, for example by showing its own error page
    When they open the sign-in page again within an hour
    Then the page reads the unfinished sign-in from the unspent hint
    And it learns the provider to dial again and the provider kind, never the address
    And the organization is not told and no mail is sent
    And with no hint, an expired one or one already spent, there is no unfinished sign-in
    And a social sign-in such as GitHub or Google never reads as unfinished, since only a company connection asks the IT team

  @integration
  Scenario: The sign-in page says the last sign-in did not finish
    Given this browser's last sign-in left for a provider and never came back
    When the person opens the sign-in page
    Then it says "Your last sign-in didn't finish", naming the provider kind only and never seats
    And it says to ask the IT team to assign the LangWatch app if the provider said there is no access
    And "Try again" starts that provider's sign-in again
    And "Use a different email" goes back to the address step
    And the error screen does not ask about it

  @unit
  Scenario: A refusal that does not echo the sign-in's round trip names nobody
    Given the person holds a fresh hint from a sign-in they started
    When a refusal reaches the callback with a state or RelayState other than the one the hint holds
    Then the door treats the address as unknown, so a page that forges a refusal mails nobody

  @unit
  Scenario: A SAML refusal posted back is classified like an OIDC refusal
    Given the person started a sign-in through a SAML connection with their address
    When the provider posts back a Response whose top-level status is not Success
    Then the door classifies it as the provider's refusal, with the hinted address
    And a Response whose status is Success keeps the generic failure

  @unit
  Scenario: A callback failure always lands on the sign-in error screen
    Given Better Auth answers a callback with an error redirect to this deployment's root
    And it went there because the RelayState could not be read
    Then the door moves it onto the error screen
    And an admitted code keeps its own wording, a posted refusal is the provider's refusal
    And anything else is the generic failure

  @unit
  Scenario: An oversized posted callback is not read for its status
    When a form posted to a sign-in callback is larger than 512 KiB
    Then the door stops reading its copy at that size and reads no status from it
    And Better Auth still receives the whole body

  @unit
  Scenario: An oversized sign-in start is not read for its hint
    When a sign-in start body is larger than 16 KiB
    Then the door stops reading its copy at that size and sets no hint
    And Better Auth still receives the whole body

  # Okta and Keycloak show their own error page for an unassigned person and never call back.
  # Okta lets the admin point the app's "Application Access Error Page" at a URL of ours.
  @unit
  Scenario: A provider's access error page can send the person to our refusal card
    Given the admin set the connection's refusal page URL as the app's access error page
    When the provider sends a refused person to that URL
    Then the person is sent to the sign-in error screen with the code "access_denied" and the provider kind
    And the organization is not told and no mail is sent, since nothing names the person
    And the sign-in's hint is dropped, so the next visit does not call it unfinished
    And a refusal page URL naming no known connection still lands on the plain refusal

  @unit
  Scenario: A refused sign-in's redirect never waits long on classifying it
    Given classifying a refusal has not answered within 3 seconds
    Then the person is sent the plain refusal with its reference
    And the classification carries on, so the request and its mail still land

  @unit
  Scenario: A SAML Response's status is read from its top-level StatusCode only
    When the posted SAMLResponse names a top-level status other than Success
    Then it reads as refused
    And a Success status, a missing SAMLResponse, bad base64 or an oversized body read as not refused

  @unit
  Scenario: The card's reference is the one the log line carries
    When a provider refuses a sign-in
    Then one warning is logged with the reference, the provider, the organization, the kind and the outcome
    And the address is not in the log line
    And the redirect's reference is the logged reference

  @unit
  Scenario: Without an active trace a generated reference is logged and shown
    Given no trace is active for the callback
    When a provider refuses a sign-in
    Then a generated reference is logged and carried on the redirect

  @unit
  Scenario: A failure classifying the refusal still lands on the plain refusal
    Given the classification of the refusal fails
    When a provider refuses a sign-in
    Then the person is sent the code "access_denied" with the reference
    And the sign-in never answers with a server error

  @unit
  Scenario: The screen never names the organization or any person
    When somebody opens the seat-limit or refusal screen with any query string
    Then the screen names no organization and no person

  @unit
  Scenario: A provider kind outside the allowlist is ignored
    Given somebody opens the refusal screen with an "idp" the allowlist does not hold
    Then the screen says their company's sign-in refused it, and echoes nothing from the address
