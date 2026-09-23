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

  Rule: A blank external identifier means the directory has none

    RFC 7644 makes externalId optional, and a provisioning client with none
    sends the key empty as readily as it omits it. Refusing on a minimum
    length turned that into a 400 for the whole person, so blank is read as
    absent — while a blank identifier still never reaches a store.

    @unit
    Scenario: A blank external identifier is read as none rather than refused
      Given a directory pushing a person with no external identifier
      When the push carries externalId as an empty string
      Then the push is accepted and the identifier is read as absent

  Rule: A directory is read back one whole page at a time

    A page is a slice of a result set, and a slice of an unsettled order hands
    the same person to two pages while never handing over somebody else. The
    page also says what it holds rather than what was asked for, so a provider
    that advances by the count it was told lands on the end exactly.

    @unit
    Scenario: Paging through a large directory lists everybody exactly once
      Given a directory larger than one page
      When a provider walks every page
      Then each member appears exactly once

    @unit
    Scenario: The total is the whole directory, never the page
      Given a directory larger than one page
      When a provider reads any page
      Then the reported total is the whole directory

    @unit
    Scenario: A start past the end of the directory is an empty page, not a failure
      Given a directory larger than one page
      When a provider starts past the last member
      Then the page is empty and still reports the whole total

    @unit
    Scenario: A page reports how many resources it actually carries
      Given a directory whose size is not a multiple of the page
      When a provider reads the last page
      Then the page reports its real size rather than the size requested

    @unit
    Scenario: A provider that advances by what it was told lands on the end exactly
      Given a directory whose size is not a multiple of the page
      When a provider advances by the count each page reported
      Then it reaches the last member and stops

  Rule: An external identifier resolves only within the connection that asserted it

    The identity provider's own identifier is unique to its own directory, so
    a lookup by it is answered from the mapping the presented token's
    connection owns. An identifier that connection has never seen narrows to
    nobody rather than widening back to the whole organization.

    @unit
    Scenario: Looking somebody up by the directory's own identifier works
      Given a token belonging to a directory connection
      When the provider filters users by externalId
      Then the listing answers with the person that connection means

    @unit
    Scenario: One connection cannot find another connection's person by identifier
      Given two directory connections in one organization
      When one filters by the other's externalId
      Then the listing answers with nobody

    @unit
    Scenario: An identifier the directory has never seen answers with nobody
      Given a token belonging to a directory connection
      When the provider filters by an externalId the connection never pushed
      Then the listing answers with nobody rather than everybody

  Rule: A group belongs to the connection that pushed it

    Two directories can be connected to one organization, and each carries its
    own "engineering". A read hides the other's group; a write acknowledges
    that the id exists and refuses the token's authority, so a provider is not
    handed a retryable not-found for a resource it may never change. A token
    that belongs to no connection keeps organization-wide reach, and so does a
    group created before connections were scoped.

    @unit
    Scenario: A group records the connection that pushed it
      Given a token belonging to a directory connection
      When the directory pushes a new group
      Then the group is stored against that connection

    @unit
    Scenario: A group renamed in the directory stays one group
      Given a group pushed with the directory's own identifier
      When the directory pushes it again under a new display name
      Then it is recognised as the same group rather than created twice

    @unit
    Scenario: Two connections each carry their own group of the same name
      Given a group named Engineering pushed by one connection
      When another connection pushes its own Engineering
      Then the second group is created against the second connection

    @unit
    Scenario: A read hides a sibling connection's group
      Given a group pushed by another connection
      When a token reads it
      Then the read answers not found

    @unit
    Scenario: A group that predates connection scoping stays visible
      Given a group with no connection recorded
      When a scoped token reads it
      Then the group is returned

    @unit
    Scenario: A legacy token keeps organization-wide reach
      Given a token belonging to no connection
      When it reads a group another connection pushed
      Then the group is returned

    @unit
    Scenario: A write to a sibling connection's group is refused by authority
      Given a group pushed by another connection
      When a token deletes or patches it
      Then the write is refused with scim_write_outside_connection

    @unit
    Scenario: A connection may only name people its own directory asserted
      Given a scoped token pushing a group with members
      When the push names a person
      Then the identity mapping is asked whether this connection may write them

  Rule: A summary of several directories reports the least healthy one

    An administrator reading a closed tab has the colour and the count and
    nothing else. A badge that reads green while one of two connections has
    stopped is the failure both summaries exist to catch, so the worst
    condition among the sources wins.

    @unit
    Scenario: One source that stopped is never summarised as working
      Given one directory syncing and another that has stopped
      When the overview summarises them
      Then the summary does not say everything is working

    @unit
    Scenario: A group echoes the identifier its directory sent
      Given a directory pushing a group with its own identifier
      When the group is created
      Then the answer carries that identifier back

  Rule: A provisioning token is only offered the connections that could carry it

    A token's whole write authority is the connection it is bound to, so the
    page offers the organization's connections as the module that owns them
    answers - and never one that cannot route, which authenticates perfectly
    and provisions nobody, discovered at the provider rather than here.

    @unit
    Scenario: The connections offered are the ones the identity module holds
      Given an organization with directory connections
      When the settings page asks which one a token could be minted against
      Then the connections come back with their lifecycle state

    @integration
    Scenario: Only live connections are offered when issuing a provisioning token
      Given an organization with a live connection and one that was never turned on
      When an administrator goes to issue a provisioning token
      Then only the live connection is offered to bind it to

    @integration
    Scenario: A single live connection is taken without asking
      Given exactly one connection that routes
      When a token is generated
      Then the mint names that connection

    @integration
    Scenario: Several live connections hold the mint until one is named
      Given two connections that route
      When the generate dialog opens
      Then the mint is held until one of them is chosen

    @integration
    Scenario: An organization with nothing live says so rather than offering an empty choice
      Given an organization whose only connection is still a draft
      When the generate dialog opens
      Then no token is minted and the page says a connection has to come first

    @integration
    Scenario: Two connections at the same provider are told apart by their protocol
      Given two connections that route, both named for the same identity provider
      When the generate dialog offers them
      Then each is named with the protocol identity recorded for it
      And a connection whose protocol is unrecorded is offered under its name alone

    @integration
    Scenario: A token issued against a connection since retired still names it
      Given a token issued against a connection that has been torn down
      When the provisioning tokens are read
      Then the token still names the connection it was issued against

  Rule: Every refusal answers in SCIM's own error document, byte for byte as main answered it

    An identity provider reads `status` and `detail` off RFC 7644's error resource and
    nothing else, so a refusal in any other shape reads as an outage. The route renders
    it, whichever stage refused: the directory door, the body, or the operation.

    @unit
    Scenario: A provisioning call with no bearer, or one this deployment never minted, is refused as SCIM's 401
      Given the SCIM family mounted behind the process's own error boundary
      When a provisioning route is called with no bearer, or with a bearer that names no token
      Then the answer is application/scim+json at 401 with main's error document for that case

    @unit
    Scenario: A token whose organization lost the plan is refused as SCIM's 403
      Given a valid token for an organization whose plan no longer includes directory sync
      When a provisioning route is called with it
      Then the answer is application/scim+json at 403 naming the plan the feature needs

    @unit
    Scenario: A token whose connection is being retired cannot write, and is refused as SCIM's 403
      Given a valid token issued against a connection whose teardown is pending, or which is gone
      When a provisioning route is called with it, to read or to write
      Then the answer is application/scim+json at 403 saying the token can no longer write through its connection
      And nothing is written, the token is not marked used, and the refusal is filed on the request log

    @unimplemented
    Scenario: A token whose connection is replaced by one that has begun finalizing cannot write
      Given a valid token issued against a connection still live
      And a replacement for that connection whose migration is finalizing or finalized
      When a provisioning route is called with it
      Then the answer is application/scim+json at 403 saying the token can no longer write through its connection

    @unit
    Scenario: A body that is not JSON, or not a resource we accept, is refused as SCIM's 400
      Given the SCIM family mounted behind the process's own error boundary
      When a directory pushes a body that does not parse, or a resource missing a field
      Then the answer is application/scim+json at 400 with main's detail for that case

    @unit
    Scenario: A refusal the operation raises answers in SCIM's document at its own status
      Given an operation that refuses with a protocol refusal, or with any other handled error
      When a directory calls the route
      Then a protocol refusal is answered as its own document
      And any other handled refusal carries its code in scimType beside its message

    @unit
    Scenario: A failure nobody handled is SCIM's 500 and says nothing more
      Given an operation that fails with an unhandled error
      When a directory calls the route
      Then the answer is application/scim+json at 500 saying only that the request could not be completed

    @unit
    Scenario: A deprovisioning answers 204 with no body and no media type
      Given a member the directory deprovisions
      When the delete succeeds
      Then the answer is 204 with no body and no Content-Type

  Rule: A request is read the way main read it

    @unit
    Scenario: A repeated query parameter is read by its first value, as main read it
      Given a directory that sends a list query parameter twice
      When it reads a collection
      Then the first value is the one served, and the page is not refused

    @unit
    Scenario: A pushed resource is read as JSON whatever media type it names, as main read it
      Given a directory that pushes a JSON resource under a media type that is not JSON
      When the resource is valid
      Then it is provisioned as if the media type had named JSON
