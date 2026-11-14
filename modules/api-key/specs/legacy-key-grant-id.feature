Feature: The legacy key grant is attached under the id authz resolves

  A key created before the authorization engine cutover, holding no grant of its own, implies
  an organization grant that the read-through mint records. The grant id is authz's own: api-key
  asks `AuthzApi.resolveGrantId` rather than deriving it, so a stored grant, revoked or not, is
  reused and a revoked one is never minted afresh beside itself.

  @unit
  Scenario: The read-through mint attaches under the grant id authz resolves
    Given a pre-cutover key with no grant of its own
    When the mint builds the binding it attaches
    Then the binding carries the id authz resolved for the key's organization grant
