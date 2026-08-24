Feature: An ingestion-key rotation answers as soon as the new key works

  The first `langwatch claude` after a logout rotates the project's ingestion
  key. That request used to sit in silence well over twenty seconds before it
  handed the token back, long enough that the user reached for Ctrl+C.

  A rotation does two things: it retires the credential that was there, and it
  issues the one that replaces it. The user waits for the second. Waiting for
  the cleanup of the first buys the user nothing, because the old token is
  already refused by then.

  Background:
    Given an organization whose writes ride the grants ledger

  Rule: a rotation answers on the new key, not on the cleanup of the old one

    @unit
    Scenario: Retiring the old key's private role does not hold the answer
      Given a role that nothing reads again once it is retired
      When the role is retired
      Then the retirement is recorded
      And the caller is not held until it takes effect

    @unit
    Scenario: A new restricted key is usable the moment it is returned
      Given a restricted API key create with custom permissions
      When the key is created
      Then its private permissions exist before the key is granted them

    @unit
    Scenario: Rotating a key answers without waiting on the old key's cleanup
      Given a live ingestion key for the same project and source type
      When the key is rotated
      Then the old token is refused from that moment on
      And the request is not held until the old key's cleanup takes effect
