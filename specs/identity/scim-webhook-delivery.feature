Feature: The Auth0 directory webhook provisions only what its credential names
  As an enterprise whose identity provider pushes changes to LangWatch over a
  webhook rather than the SCIM protocol
  I need every delivery to be proved fresh, unique and signed by the secret
  this deployment configured, and to act only on the organization its own
  credential names
  So that a captured delivery, a guessed domain or a replayed request cannot
  provision anybody

  # WHY A SEPARATE DOOR. Auth0 pushes directory changes at one literal path
  # rather than speaking the SCIM protocol, so this intake is public - it
  # carries no session and no bearer credential of ours. Everything that
  # makes it safe is therefore in the delivery itself: the signature over the
  # raw body, the timestamp, and the directory token it presents.
  #
  # THE ORGANIZATION COMES FROM THE CREDENTIAL, NEVER THE PAYLOAD. Resolving
  # it from the email domain in the body let anybody who could sign a
  # delivery choose whose organization to provision into. The token names one
  # organization and that is the only one this delivery may touch, so the
  # domain lookup is not consulted at all.
  #
  # A DEPLOYMENT THAT CONFIGURED NO SECRET SERVES NO DOOR. It answers as
  # though the path does not exist, rather than as an endpoint that is
  # present and refusing - which would tell an unauthenticated caller that
  # this installation has directory sync at all.

  Background:
    Given a deployment with a configured webhook secret
    And a directory token issued for the organization "acme"

  Rule: a delivery acts only on the organization its credential names

    @unit
    Scenario: A signed SCIM webhook delivery provisions the token's own organization
      Given a delivery signed with the configured secret, carrying the directory token
      And a payload whose email domain belongs to another organization
      When it arrives
      Then the user is provisioned into "acme"
      And no organization is looked up by sign-on domain

  Rule: an unproved delivery provisions nothing

    @unit
    Scenario: A SCIM webhook delivery without a directory token provisions nothing
      Given a signed delivery presenting no directory token
      When it arrives
      Then it is refused as unauthorized
      And no user is provisioned

    @unit
    Scenario: A SCIM webhook delivery signed with the wrong secret is refused
      Given a delivery signed with a secret this deployment did not configure
      When it arrives
      Then it is refused as unauthorized
      And no user is provisioned

    @unit
    Scenario: A replayed SCIM webhook delivery is refused
      Given a delivery that has already been accepted
      When the identical delivery arrives a second time
      Then the second is refused as unauthorized
      And the user is provisioned exactly once

    @unit
    Scenario: A SCIM webhook delivery outside the freshness window is refused
      Given a correctly signed delivery whose timestamp is older than the freshness window
      When it arrives
      Then it is refused as unauthorized
      And no user is provisioned

  Rule: a deployment without directory sync serves no webhook at all

    @unit
    Scenario: A deployment without directory sync does not serve the SCIM webhook
      Given a deployment that configured no webhook secret
      When any delivery arrives
      Then it is answered as though the path does not exist
