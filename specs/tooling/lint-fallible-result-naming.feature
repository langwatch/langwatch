Feature: The fallible-result-naming lint rule
  A method on a strict feature API, app, port, service, repository or store
  answers or throws. A `try`-prefixed method whose own body catches a failure
  and hands the caller null or undefined instead is refused, and the fix is to
  delete that catch and drop the prefix — renaming it `find*` only moves the
  hedge into the name. A `try`-prefixed declaration with no such catch — an
  interface signature, an abstract method, or a body that never converts a
  failure into an absence — carries a naming defect too, but that defect
  belongs to a separate rule (`langwatch/no-try-prefix`) whose message does
  not claim a catch it cannot see; this rule falls through to whichever of its
  own checks already applies to that name, except one: a nullable `try`-prefixed
  name is exempt from nullableWithoutFind here, since no-try-prefix already
  prescribes the same `find<Noun>` rename for it, and reporting both would be
  one defect stated twice. Absence as a normal outcome, decided on its own
  merits rather than to escape a `try`, is a `find*` method returning
  undefined, and only a `find*` method may carry a nullable result. No
  redundant `require` prefix, and every method states its result type.

  A repository answers `find*`; `get*` and `list*` are the service layer's
  vocabulary. A repository's interface file and both its backends
  (`repositories/`, `repositories/prisma/`, `repositories/memory/`) are
  checked for a public method or interface signature named with that
  vocabulary, and told to rename to `find*` instead — in the interface and in
  every implementation. A `get*`/`list*` repository method that is also
  nullable draws only this one message: the same rename that fixes the
  vocabulary is what makes the nullable return legal, so nullableWithoutFind
  stays silent for it rather than prescribing the same fix twice. Outside a
  repository file, `get*` keeps its ordinary meaning and this check says
  nothing.

  One `get*` in a repository is not the service layer's vocabulary borrowed:
  it is the one-or-throw shape, and it is correct there. A repository method
  whose declared result cannot be null or undefined answers or raises, which
  is what `get*` means, so the vocabulary check passes over it. `list*` is not
  exempted the same way — a list answers an array, and an array is what
  `find*` names — and neither is a `get*` that can still answer with absence,
  because that one really is the `find*` shape wearing the wrong prefix.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A try-prefixed method with a swallowing catch is refused
    Given a try-prefixed method whose body catches a failure and returns null, undefined, or nothing, or whose promise chain ends in a `.catch(() => null)`
    When the fallible-result-naming rule runs over it
    Then it reports tryPrefix with the plain rename, whatever the declared return type

  @unit
  Scenario: A try-prefixed declaration with no catch is not accused of one
    Given a try-prefixed declaration that has no body, or a body with no catch, or a catch that rethrows
    When the fallible-result-naming rule runs over it
    Then it does not report tryPrefix
    And it falls through to noResultType when that already applies to the name

  @unit
  Scenario: Dropping the try prefix means throwing, not renaming to find
    Given a try-prefixed method whose catch swallows the failure
    When the fallible-result-naming rule runs over it
    Then the fix tells the author to name it without the prefix and make the body throw
    And it says renaming it to find is not the fix

  @unit
  Scenario: A nullable result is reported unless the name is find-prefixed
    Given a method whose result type is nullable and is not named try*
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind unless the method is named find*
    And a getter that always answers or throws is left alone
    And the fix it offers names get or getBy and throwing, never a new nullable find*

  @unit
  Scenario: A nullable try-prefixed method reports the rename once, not twice
    Given a try-prefixed method whose result type is nullable, whether or not its body swallows a failure
    When both the fallible-result-naming and no-try-prefix rules run over it
    Then fallible-result-naming does not report nullableWithoutFind for it
    And no-try-prefix reports noTryPrefix for the same method, so the rename is prescribed exactly once

  @unit
  Scenario: The require prefix is reported with a rename fix
    Given a port method named with the redundant require prefix
    When the fallible-result-naming rule runs over it
    Then it reports requirePrefix naming the method

  @unit
  Scenario: A missing result type is reported
    Given a port method with no explicit return type
    When the fallible-result-naming rule runs over it
    Then it reports noResultType
    But a method of a class that implements an interface is left alone, since the interface states the type

  @unit
  Scenario: A repository get method is reported
    Given a repository class method named get or getSomething whose result is nullable or an array, in the interface file or a prisma or memory backend
    When the fallible-result-naming rule runs over it
    Then it reports repositoryServiceVocabulary naming the find-prefixed rename
    And a bare get renames to findAll
    And it does not also report nullableWithoutFind when the same method is nullable
    But a find-prefixed method on the same file is left alone

  @unit
  Scenario: A repository get method that cannot answer with absence is left alone
    Given a repository class method named get or getSomething whose declared result is neither nullable nor an array
    When the fallible-result-naming rule runs over it
    Then it reports nothing for that method
    But a get method on the same file whose result is nullable is still reported
    And a list method on the same file is still reported whatever its result type

  @unit
  Scenario: A repository list signature is reported
    Given a repository interface's TSMethodSignature named list or listSomething
    When the fallible-result-naming rule runs over it
    Then it reports repositoryServiceVocabulary naming the find-prefixed rename
    But a get accessor on the same file is left alone

  @unit
  Scenario: A service get method is left alone
    Given a get-prefixed method declared outside a repository file
    When the fallible-result-naming rule runs over it
    Then it does not report repositoryServiceVocabulary
    But nullableWithoutFind still applies to it as before

  # A conversion is handed the thing it converts. When it answers with absence it
  # is saying "the input carried none", not "no such record exists", and the two
  # are different facts. The rule's only remedy for a nullable result is a
  # find-prefixed rename, and since the naming decision of 2026-09-16 `find`
  # states cardinality: it returns an array. So a conversion cannot take the name
  # the rule prescribes without lying about what it gives back, which leaves the
  # rule firing where it has no fix to offer.
  @unit
  Scenario: A conversion that answers with absence is left alone
    Given a nullable-returning function whose name begins with a conversion verb such as parse, extract, build, stringify, serialize, decode, format or as
    When the fallible-result-naming rule runs over it
    Then it does not report nullableWithoutFind for that function
    But a lookup-named nullable function in the same file is still reported
    And a try-prefixed conversion whose catch swallows the failure is still reported, because the try prefix is a separate fault

  @unit
  Scenario: A conversion with no declared result type is still reported
    Given a function whose name begins with a conversion verb and which declares no return type
    When the fallible-result-naming rule runs over it
    Then it still reports noResultType
    Because the exemption answers what absence means, and an undeclared result states nothing at all

  @unit
  Scenario: A derivation verb may answer undefined
    Given a service method named with a derivation verb that answers undefined
    When the fallible-result-naming rule runs over it
    Then it reports nothing

  @unit
  Scenario: resolve and read stay governed
    Given a service method named resolve or read that answers undefined
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind
