Feature: Enterprise SCIM package boundary
  SCIM contracts and token verification are reusable outside the application.

  @unit
  Scenario: Token values are stored only as hashes
    When an organization generates a SCIM token
    Then the repository receives a SHA-256 hash rather than the token value

  @unit
  Scenario: Entitlement is checked whenever a token is exercised
    Given a valid SCIM token for an organization without an Enterprise plan
    When an identity provider exercises the token
    Then verification reports plan_not_entitled without recording token use

  @unit
  Scenario: Revocation is organization scoped
    Given a token owned by another organization
    When an organization tries to revoke it
    Then the service reports scim_token_not_found

  Rule: The directory webhook is authenticated, fresh, and tenanted by its credential

    The deployment secret proves the delivery came from the configured provider
    integration; it never names a tenant. The organization provisioned is the one
    the presented SCIM token belongs to, so a payload cannot select a directory.

    @unit
    Scenario: A signed SCIM webhook delivery provisions the token's own organization
      Given a delivery signed with the deployment secret
      And a SCIM token belonging to one organization
      When the payload names an e-mail address in another organization's domain
      Then the member is provisioned in the token's organization
      And the payload's domain resolves no organization at all

    @unit
    Scenario: A SCIM webhook delivery without a directory token provisions nothing
      Given a delivery signed with the deployment secret and no SCIM token
      When the webhook is delivered
      Then the delivery is refused and nothing is provisioned

    @unit
    Scenario: A SCIM webhook delivery signed with the wrong secret is refused
      Given a delivery signed with a secret the deployment does not hold
      When the webhook is delivered
      Then the delivery is refused and nothing is provisioned

    @unit
    Scenario: A replayed SCIM webhook delivery is refused
      Given a delivery that was already accepted
      When the same bytes and signature are delivered again
      Then the second delivery is refused and provisions nothing twice

    @unit
    Scenario: A SCIM webhook delivery outside the freshness window is refused
      Given a delivery signed an hour ago
      When the webhook is delivered
      Then the delivery is refused and nothing is provisioned

    @unit
    Scenario: A deployment without directory sync does not serve the SCIM webhook
      Given a deployment that configured no webhook secret
      When the webhook is delivered
      Then the response does not distinguish the path from one that was never served

  Rule: A filter the directory cannot honour is refused, never widened

    Both listings match on one attribute each. A filter naming any other
    attribute used to read as no filter at all, so a provider asking for one
    person was answered with the whole organization and read the first row back
    as the person it asked about.

    @unit
    Scenario: A user listing filtered by an unsupported attribute is refused
      Given a directory listing users
      When the provider filters by an attribute the listing cannot match
      Then the listing is refused with invalidFilter at 400

    @unit
    Scenario: A group listing filtered by an unsupported expression is refused
      Given a directory listing groups
      When the provider sends an expression richer than equality
      Then the listing is refused with invalidFilter at 400

    @unit
    Scenario: A user listing filtered by userName matches without regard to case
      Given a directory listing users
      When the provider filters by userName
      Then the listing narrows to that address

  Rule: A name is patched one half at a time

    SCIM carries a name as two parts and this product stores one string, so a
    patch naming only the surname keeps the forename it did not mention.

    @unit
    Scenario: A patch naming only the surname keeps the forename
      Given a member stored as one display name
      When the directory patches only the family name
      Then the stored name keeps its given name

    @unit
    Scenario: A patch sending the family name as a dotted path is applied
      Given a member stored as one display name
      When the directory patches name.familyName with a scalar value
      Then the stored name is updated rather than silently accepted
