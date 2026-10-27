Feature: The handled-error-outside-contract lint rule
  A service throws a HandledError subclass and a client reads its code, so
  both sides need the class; it lives in the module's contract, never in the
  process package a client may not import. The rule follows the superclass
  back to `@langwatch/handled-error`, through that package's own base classes
  and through classes declared in the same file.

  @unit
  Scenario: A HandledError subclass declared in the process package is reported
    Given a process service that declares a class extending HandledError
    When the handled-error-outside-contract rule runs over it
    Then it reports handledError and names the module's contract errors file

  @unit
  Scenario: A subclass of a handled-error base class is reported
    Given a process service that extends a base class imported from @langwatch/handled-error under an alias
    When the handled-error-outside-contract rule runs over it
    Then it reports the class on its own line and names the base it extends

  @unit
  Scenario: A subclass reaching HandledError through a same-file class is reported
    Given a process service whose error class extends another class in the same file that extends HandledError
    When the handled-error-outside-contract rule runs over it
    Then it reports every class in the chain

  @unit
  Scenario: A subclass of a plain error is not this rule's business
    Given a process service whose error classes reach only the built-in Error
    When the handled-error-outside-contract rule runs over it
    Then it reports nothing

  @unit
  Scenario: A HandledError subclass in an enterprise process package is reported
    Given an enterprise process service that declares a class extending HandledError
    When the handled-error-outside-contract rule runs over it
    Then it names the enterprise module's contract errors file

  @unit
  Scenario: A HandledError subclass declared in its contract package is not this rule's business
    Given a contract errors file that declares a class extending HandledError
    When the handled-error-outside-contract rule runs over it
    Then it reports nothing
