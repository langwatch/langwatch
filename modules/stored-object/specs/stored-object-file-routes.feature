Feature: File reads answer through the installed stored-object module
  The process mounts the /api/files byte door over the one StoredObjectApp boot
  constructed; the caller comes from the process's own browser verifier, the
  read count from its rate limiter, and the person's permission from authz.

  @regression
  Scenario: the installed module answers a file read through the process's verifier
    Given the stored-object module is installed over memory stores
    When a signed-in member with a file-view permission reads an object the project does not hold
    Then the route answers 404 not_found rather than failing inside the handler

  @regression
  Scenario: the installed module refuses a caller past its read allowance
    Given the stored-object module is installed over memory stores
    When a signed-in member has spent the read allowance
    Then the route answers 429 rate_limited with a Retry-After hint

  @regression
  Scenario: the installed module refuses a file read with no credential
    Given the stored-object module is installed over memory stores
    When the request carries no session
    Then the door answers 401

  @unimplemented
  Scenario: the installed module refuses a member without a file-view permission
    Given the stored-object module is installed over memory stores
    When a signed-in member holds neither traces:view nor scenarios:view on the owning project
    Then the route answers 403
