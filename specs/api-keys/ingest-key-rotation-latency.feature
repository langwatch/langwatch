Feature: An ingestion-key rotation answers within one convergence window

  Rotating an ingestion key rides the grants ledger: revoke the prior key's
  bindings, delete its private role, define the new key's role, attach the
  new key's binding. Every one of those writes used to hold the request
  until the grants projection landed it, so one rotation stacked several
  full fold pickup cycles. The first `langwatch claude` after a logout sat
  well over twenty seconds on that one mint request, with no feedback.

  A hold earns its place only where the request, or the write after it,
  reads what the fold wrote. Deleting the prior key's private role is not
  such a write: the key row is revoked imperatively, so the credential is
  dead on the next read, and the role is named after that key id, so the
  new key's role never waits for the name. Defining the new key's role is
  such a write: the binding attached right after carries a foreign key to
  the role row. Commands are queued per command name rather than per
  organization, so no ordering between two different commands can stand in
  for a hold.

  Background:
    Given an organization whose writes ride the grants ledger

  Rule: a request holds where a later read needs the fold, and nowhere else

    @unit
    Scenario: Deleting a role that nothing reads again can skip the hold
      Given a caller that only needs the role retired
      When the role is deleted without its own projection hold
      Then the deletion command is still appended
      And the request does not poll for the role row's disappearance

    @unit
    Scenario: A restricted key's private role lands before its binding attaches
      Given a restricted API key create with custom permissions
      When the key is created
      Then the private role definition finishes before the binding attaches

    @unit
    Scenario: A hard-cut rotation holds once, on the new key's grants
      Given a live ingestion key for the same project and source type
      When the key is rotated
      Then the prior key's revocation carries no projection hold of its own
      And the prior key is revoked on the key row itself either way
