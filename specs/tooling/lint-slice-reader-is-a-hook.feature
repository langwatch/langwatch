Feature: The slice-reader-is-a-hook lint rule
  A `defineSlice` or `readSlice` reader is a hook. The React Compiler recognises a
  hook only by its `use` name, and caches a call to any other name inside a memo
  block, so the hook runs on the first render and is skipped on the next. The
  reader is bound to a `use`-prefixed name.

  @unit
  Scenario: A slice reader under a plain name is reported
    Given a browser file that binds defineSlice to a name without use
    When the slice-reader-is-a-hook rule runs over it
    Then it reports sliceReaderName

  @unit
  Scenario: A slice reader under a use name is accepted
    Given a browser file that binds readSlice to a use-prefixed name
    When the slice-reader-is-a-hook rule runs over it
    Then it reports nothing

  @unit
  Scenario: Other calls under plain names are not this rule's business
    Given a browser file that binds another factory to a plain name
    When the slice-reader-is-a-hook rule runs over it
    Then it reports nothing
