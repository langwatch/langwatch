Feature: Langy session key lifecycle
  A Langy session key is a per-user, least-privilege API key that the worker
  subprocess carries in its environment. Its lifetime is the WORKER's, not the
  turn's: the key is injected at spawn and a reused worker keeps the key it
  booted with.

  Before this change the control plane minted a fresh key on EVERY turn and
  pushed it to the manager, which discarded it whenever it reused a worker. The
  observable consequences, measured on a dev box after a handful of turns:
  41 keys minted, only 14 ever used, none ever revoked, each valid for six hours.
  That is credential sprawl — every unused key is a live credential carrying the
  user's full Langy scope — and it put an API-key write on the critical path of
  every message.

  So: mint only when a worker is actually going to be spawned, and revoke when
  that worker dies.

  The manager is NOT trusted to mint. It can ask "do I already have a worker for
  this conversation with these capabilities?" and it can ask the control plane to
  REVOKE a key it was handed, but it can never ask for a key to be created. A
  revoke-only callback is fail-closed: the worst a compromised manager can do is
  destroy its own access.

  Background:
    Given a project with Langy enabled
    And a user who holds at least one Langy permission in that project

  Rule: A key is minted only when a worker must actually be spawned

    Scenario: The first turn of a conversation mints a key
      Given no worker is running for the conversation
      When the user sends a message
      Then the control plane mints a session key for that user and project
      And the worker is spawned carrying that key

    Scenario: A follow-up turn on a live worker mints nothing
      Given a worker is already running for the conversation
      And its capabilities match what the turn needs
      When the user sends another message
      Then no session key is minted
      And no API key row is written
      And the turn is served by the running worker, still using the key it booted with

    Scenario: A turn that changes the worker's capabilities mints a new key
      Given a worker is already running for the conversation
      And the user picks a different model
      When the user sends another message
      Then the running worker is replaced
      And a session key is minted for the replacement worker
      And the replaced worker's key is revoked

  Rule: The spawn-after-probe race is resolved, never guessed

    # The worker can die between "is one alive?" and "here is the turn". The
    # control plane must not paper over this by sending a key every time, which
    # is the behaviour we are removing.
    Scenario: The worker dies between the probe and the turn
      Given a worker is running when the control plane checks
      And that worker dies before the turn arrives
      When the turn arrives without a session key
      Then the manager refuses the turn and says credentials are required
      And the control plane mints a key and retries the turn exactly once
      And the user sees a normal response

    Scenario: The retry is not unbounded
      Given the manager keeps reporting that credentials are required
      When the control plane has already retried once with a freshly minted key
      Then it does not retry again
      And the turn fails with an error the user can act on

  Rule: A key does not outlive its worker

    Scenario Outline: Every death path the manager can observe revokes the key
      Given a worker is running with a session key
      When the worker <death>
      Then the manager asks the control plane to revoke that key
      And the key can no longer be used

      Examples:
        | death                                          |
        | is replaced because capabilities changed       |
        | is reaped for being idle                       |
        | exits on its own                               |
        | is stopped because the manager is shutting down |

    Scenario: Revocation failure never breaks a turn
      Given a worker has died
      When the control plane cannot be reached to revoke its key
      Then the manager logs the failure
      And the turn in progress is unaffected
      And the key is still cleaned up eventually by expiry

  Rule: Revocation is best-effort, so expiry is the backstop

    # A manager that is SIGKILLed — OOM, node eviction, force-delete — fires no
    # callback at all. Revocation-on-death shrinks the window; it cannot close
    # it. The reaper is what actually guarantees no key outlives its usefulness,
    # and removing it would leave a six-hour tail of live credentials on every
    # hard kill.
    Scenario: A key whose manager was killed outright is still cleaned up
      Given a worker is running with a session key
      And the manager is killed without running any cleanup
      When the key's lifetime elapses
      Then the reaper revokes the key
      And no expired Langy session key remains usable

  Rule: The manager can revoke, but never mint

    Scenario: The manager cannot ask for a key to be created
      When the manager calls the control plane
      Then the only credential operation available to it is revocation

    Scenario: The revoke endpoint refuses keys that are not Langy session keys
      Given an API key that is not a Langy session key
      When the manager asks the control plane to revoke it
      Then the control plane refuses
      And the key is left untouched

    Scenario: The revoke endpoint requires the internal secret
      When a caller without the internal secret asks to revoke a key
      Then the control plane refuses
