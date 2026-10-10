Feature: The signature-mirror lint rule
  A boundary type written as `Parameters<typeof x>` or `ReturnType<typeof x>`
  follows whatever `x` is today, so the contract stops saying what the boundary
  accepts. The rule reads the boundaries - a module's contract, its process
  `app/` folder, and the applications' composition roots - and reports each
  global mirror type where it is written. A local declaration of the same name
  is not the global utility. Casting through unknown is `stand-in-cast`'s.

  @unit
  Scenario: A boundary type mirrored through a global utility type is reported where it is written
    Given a contract file that types an input as Parameters of a function
    When the signature-mirror rule runs over it
    Then it reports mirroredSignature on that line, naming Parameters

  @unit
  Scenario: A local declaration that shadows the utility name is not a mirror
    Given a contract file that declares, imports or takes a type parameter named like the utility
    When the signature-mirror rule runs over it
    Then it reports nothing

  @unit
  Scenario: Contracts, module app folders and composition roots are boundaries
    Given the same mirror type in a contract, a module app file and an application composition root
    When the signature-mirror rule runs over each
    Then it reports each one

  @unit
  Scenario: Services, tests and non-boundary application files are not read
    Given the same mirror type in a service, a test, a declaration file and an application main
    When the signature-mirror rule runs over each
    Then it reports nothing
