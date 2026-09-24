Feature: The fallible-result-naming lint rule
  A method, function or module-scope arrow const in a module's contract or
  process source names its absence contract the ADR-146 way: `get*` answers
  exactly one thing or throws, `find*` answers an array whose empty case is
  the absence, a derivation may answer undefined because its input carried
  none, and nothing new answers null. A nullable result under any other name
  is reported, including one declared through a local type alias such as
  `type Maybe<T> = T | null`. The fix never prescribes a new nullable
  `find*`; the existing nullable ones stay as they are. The `try*` and
  `require*` prefixes are `langwatch/banned-verb-prefix`'s, so a nullable
  `try*` name is left to that rule rather than reported twice. A missing
  result type is `typescript/explicit-module-boundary-types`'s.

  A repository answers `find*`; `get*` and `list*` are the service layer's
  vocabulary. A repository's interface file and both its backends
  (`repositories/`, `repositories/prisma/`, `repositories/memory/`) are
  checked for a public method or interface signature named with that
  vocabulary, and told to rename to `find*` instead — in the interface and in
  every implementation. A `get*`/`list*` repository method that is also
  nullable draws only this one message. A `get*` whose declared result can be
  neither null nor an array is the one-or-throw shape and is left alone.

  A result whose declared answer, null and undefined set aside, is one value
  rather than an array is never told to become `find*`: `find` answers an
  array. It is pointed at a throwing `get*`, or at an explicit result union
  when absence means something other than not-found.

  A method or module-scope const whose name and shape a vendor's callback
  interface dictates is exempt (ADR-146): a method of a class whose every
  `implements`/`extends` names an import from a package that is neither
  `@langwatch/*`, the `langwatch` SDK nor relative, or a const whose declared
  type heads at such an import. The same name in our own interface is still
  reported.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A nullable result is reported unless the name is find-prefixed
    Given a method whose result type is nullable and is not named try*
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind, or nullableOneValue when the answer is one value, unless the method is named find*
    And a getter that always answers or throws is left alone
    And the fix it offers names get or getBy and throwing, never a new nullable find*

  @unit
  Scenario: A nullable type alias does not hide the absence
    Given a method whose result is a local type alias of T | null, directly or through another alias
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind on the method's line
    But a method whose alias is not nullable is left alone

  @unit
  Scenario: A nullable arrow const is reported like a function
    Given a module-scope arrow const that declares a nullable result
    When the fallible-result-naming rule runs over it
    Then it reports nullableWithoutFind on the const's line
    But an arrow declared inside a function body is left alone

  @unit
  Scenario: A missing result type is left to the native boundary rule
    Given a method or function that states no result type
    When the fallible-result-naming rule runs over it
    Then it reports nothing, since typescript/explicit-module-boundary-types owns that defect

  @unit
  Scenario: A nullable try-prefixed method reports the rename once, not twice
    Given a try-prefixed method or interface signature whose result type is nullable
    When both the fallible-result-naming and banned-verb-prefix rules run over it
    Then fallible-result-naming reports nothing for it
    And banned-verb-prefix reports it once, so the rename is prescribed exactly once

  @unit
  Scenario: A repository get method is reported
    Given a repository class method named get or getSomething whose result is an array, in the interface file or a prisma or memory backend
    When the fallible-result-naming rule runs over it
    Then it reports repositoryServiceVocabulary naming the find-prefixed rename
    And a bare get renames to findAll
    And it does not also report a nullable-result finding when the same method is nullable
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
    But the nullable-result finding still applies to it as before

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

  @unit
  Scenario: A derivation verb may answer undefined
    Given a service method named with a derivation verb that answers undefined
    When the fallible-result-naming rule runs over it
    Then it reports nothing

  @unit
  Scenario: resolve and read stay governed
    Given a service method named resolve or read that answers undefined
    When the fallible-result-naming rule runs over it
    Then it reports nullableOneValue

  @unit
  Scenario: A nullable one-value result is pointed at a throwing get or a result union, never find
    Given a method whose declared answer is one value or null or undefined
    When the fallible-result-naming rule runs over it
    Then it reports nullableOneValue
    And the fix names get or getBy with throwing, or an explicit result union, and says not to rename it find
    But an answer that is an array, a local array alias or unknown keeps nullableWithoutFind

  @unit
  Scenario: A repository read answering one value is pointed at a throwing get, never find
    Given a repository method named get whose declared answer is one value or null or undefined
    When the fallible-result-naming rule runs over it
    Then it reports repositoryOneValue naming the get-prefixed name, throwing and an explicit result union
    And its message never names the find-prefixed rename
    But a list method answering a page keeps the find-prefixed rename ADR-146 maps a repository list to

  @unit
  Scenario: A vendor callback is exempt, and our own interface of the same shape is not
    Given a method of a class implementing or extending only vendor imports, or a const typed by a vendor import
    When the fallible-result-naming rule runs over it
    Then it reports nothing
    But the same declaration typed by a @langwatch, langwatch SDK, relative or mixed heritage is reported
    And the same method on a class with no heritage is reported
