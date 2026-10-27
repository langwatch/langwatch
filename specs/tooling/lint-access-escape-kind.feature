Feature: The access-escape-kind lint rule
  A route that opens its door without a permission (`publicRoute`,
  `anyAuthenticated`, `deferredScope`, `optionalCredential`, `noPermission`,
  `serviceAuthorized`) is a security decision a reviewer must see, so each
  one states a non-blank reason; its wording is not judged. A handler that calls an `admitX` operation
  beside its work is asking authorization the door should have asked.

  @unit
  Scenario: An escape-kind access declaration is reported
    Given a module transport using publicRoute with no reason, serviceAuthorized with a blank one and a bare noPermission
    When the access-escape-kind rule runs over it
    Then it reports escapeKind for each

  @unit
  Scenario: A handler pairing admitX with an operation is reported
    Given a module transport whose handler calls admitOperator and then an operation
    When the access-escape-kind rule runs over it
    Then it reports admitInHandler

  @unit
  Scenario: A route with a named permission is accepted
    Given a module transport that declares withPermission
    When the access-escape-kind rule runs over it
    Then it reports nothing

  @unit
  Scenario: An escape kind with a reason is accepted
    Given a module transport whose escape kinds pass a reason or a named declaration
    When the access-escape-kind rule runs over it
    Then it reports nothing

  @unit
  Scenario: A handler answering with an admitX operation is accepted
    Given a module transport whose handler returns the result of an admitX operation
    When the access-escape-kind rule runs over it
    Then it reports nothing

  @unit
  Scenario: An escape kind with a quoted reason key is accepted
    Given a module transport whose escape kind passes its reason under a quoted "reason" key
    When the access-escape-kind rule runs over it
    Then it reports nothing
