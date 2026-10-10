Feature: The credential-reader-owner lint rule
  Reading a credential off a request is the door's job. Only `packages/api`,
  `packages/process` and `modules/auth` may import or declare a credential
  reader (`*CredentialOfRequest`, `browserCallerOfRequest`,
  `principalOfCredential`, `extractBearer*`). The rule accepts a disable that
  states why the framework cannot express the case.

  @unit
  Scenario: A credential reader imported by a module is reported
    Given a module file that imports projectCredentialOfRequest
    When the credential-reader-owner rule runs over it
    Then it reports credentialReader naming the reader

  @unit
  Scenario: A hand-written bearer extractor is reported
    Given a module service that declares extractBearerToken
    When the credential-reader-owner rule runs over it
    Then it reports the declaration

  @unit
  Scenario: The door's own package may read credentials
    Given packages/api declaring projectCredentialOfRequest
    When the credential-reader-owner rule runs over it
    Then it reports nothing

  @unit
  Scenario: A credential reader called through a namespace import is reported
    Given a module file that calls projectCredentialOfRequest through a namespace import
    When the credential-reader-owner rule runs over it
    Then it reports credentialReader naming the reader, and nothing for the same name on another object
