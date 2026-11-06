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
    Then the answer sets a signed, httpOnly, SameSite=Lax hint cookie that expires in 15 minutes
    And when the provider's callback answers, the hint cookie is cleared

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
