Feature: One global UI store, namespaced by module

  The browser holds one client-state store. Each module keeps its state in
  slices named under its own prefix (`langy:store`, `shell:upgrade-modal`) and
  writes only there; any module may read any slice, so state is shared without
  wiring. Server data never enters it.

  @unit
  Scenario: A module writes only its own slice and reads any slice
    Given the "langy" module declared the slice "langy:store"
    And the "trace" module declared the slice "trace:explorer"
    When the "langy" module writes its slice
    Then the "trace" slice is unchanged
    And the "trace" module reads the "langy" slice through a reader that cannot write
    And a slice name outside the "<module>:<key>" form is refused

  @unit
  Scenario: A persisted slice survives a reload and keeps only the keys it chose
    Given a slice declared with a set of keys to keep on this device
    When it is written and the module is declared again
    Then the kept keys are restored and the rest start from their initial value

  @unit @integration
  Scenario: A persisted preference belongs to the reader who chose it
    Given a reader kept a preference in a persisted slice
    When the page reloads for the same reader
    Then the preference is restored
    But a different reader on the same device starts from the initial value
    And with nobody signed in nothing is kept

  @unit @integration
  Scenario: Sign-out forgets every persisted preference on the device
    Given readers kept preferences in persisted slices
    When the reader signs out
    Then every reader's persisted keys are removed and other keys are left alone

  @integration
  Scenario: Sign-out clears everything the tab kept in session storage
    Given the tab kept a voice draft, a PKCE verifier and attribution in session storage
    When the reader signs out
    Then the tab's session storage is empty

  @unit
  Scenario: Reading a slice nobody declared is refused by name
    When a module reads a slice that no module declared
    Then the read fails naming the slice
    But a reader that named what it sees without the owner gets that instead

  @unit
  Scenario: Workflow's host actions reach another module through the store
    Given workflow published its host actions as the "workflow:host" slice
    When experiment's Replicate dialog renders with no provider above it
    Then it lists the copy targets workflow's host answered
    And a target the reader may not create in is shown closed
