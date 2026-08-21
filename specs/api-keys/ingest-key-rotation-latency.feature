Feature: An ingestion-key rotation answers within one convergence window

  Rotating an ingestion key rides the grants ledger: revoke the prior key's
  bindings, delete its private role, define the new key's role, attach the
  new key's binding. Every one of those writes used to hold the request
  until the grants projection landed it, and the organization's ledger
  queue delivers writes in order, so one rotation stacked up to four full
  fold pickup cycles. The first `langwatch claude` after a logout sat well
  over twenty seconds on that one mint request, with no feedback.

  Only the last write of a chain needs the hold. The queue is FIFO per
  organization, so the final write's projection landing proves every
  earlier write of the same request landed too. The intermediate writes
  stay durable either way; skipping their holds changes when the request
  answers, never what the fold applies.

  Background:
    Given an organization whose writes ride the grants ledger

  Rule: a request chains its ledger writes behind one hold, not one each

    @unit
    Scenario: Defining a role can leave the hold to a later write
      Given a caller that follows the role definition with an awaited write
        on the same organization's queue
      When the role is defined without its own projection hold
      Then the definition command is still appended
      And the request does not poll for the role row

    @unit
    Scenario: Deleting a role can leave the hold to a later write
      Given a caller that follows the role deletion with an awaited write
        on the same organization's queue
      When the role is deleted without its own projection hold
      Then the deletion command is still appended
      And the request does not poll for the role row's disappearance

    @unit
    Scenario: A restricted key's private role rides the grant attach's hold
      Given a restricted API key create with custom permissions
      When the key is created
      Then the private role definition carries no projection hold of its own
      And the grant attach that follows it holds as before

    @unit
    Scenario: A hard-cut rotation holds once, on the new key's grants
      Given a live ingestion key for the same project and source type
      When the key is rotated
      Then the prior key's revocation carries no projection hold of its own
      And the prior key is revoked on the key row itself either way
