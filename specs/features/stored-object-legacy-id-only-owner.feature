Feature: A stored object named by its id alone stays unresolvable

  Media links written before stored objects carried their project carry the
  object id and nothing else. Such a link stays unresolvable (ADR-202 Decided
  23): the byte door answers it only from the presenting key's own project's
  rows, and resolves no other owner.

  @integration
  Scenario: An id-only URL the key's own project does not record answers not found
    Given an API key for a project that holds no row for the object
    When the key fetches the object by its id alone
    Then the response is 404 with status not_found
    And no other project is asked for the object and no bytes are read
