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

    # The deliberate exception, and it is not really one: a warm IS a spawn.
    # Opening the panel pre-warms the conversation's worker before the first
    # message (specs/langy/langy-worker-prewarm.feature), and a spawned worker
    # needs its key at boot. The rule holds, the key is minted only because a
    # worker is actually going to be spawned; the spawn just happens before the
    # message instead of after it. The key dies with the warm worker: used or
    # not, worker death revokes it and expiry is the backstop, so a warm the
    # user walks away from leaves no credential behind.
    Scenario: A panel-open warm mints a key because it spawns a worker
      Given no worker is running for the conversation
      When the user opens the Langy panel and the warm finds no live worker
      Then the control plane mints a session key for that user and project
      And the warm worker is spawned carrying that key
      And if the worker is reaped unused its key is revoked with it

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

  Rule: A worker is never spawned without a usable key

    # A blank key is no key: the manager asks the control plane to mint one
    # rather than boot a CLI that would tell the reader to log in.
    @unit
    Scenario: Langy never starts its CLI with a blank key
      When a worker must be spawned and the session key is only whitespace
      Then the manager refuses the spawn and says credentials are required

  Rule: A worker never outlives its key

    # The key is injected at spawn and lives six hours, but a conversation that
    # never idles long enough to be reaped could keep its worker longer. So a
    # worker has a max age (five hours by default) and is replaced between
    # turns once it passes it; a running turn is never cut short.
    @unit
    Scenario: The probe asks for a fresh key once the worker is past its max age
      Given a worker is running for the conversation
      And the worker is older than its max age
      When the control plane asks whether a live worker exists
      Then the manager answers that none does
      And the control plane mints a session key for the next turn

    @unit
    Scenario: The next turn after the max age runs on a fresh worker with a fresh key
      Given a worker past its max age is idle between turns
      When the next turn arrives with a freshly minted key
      Then the old worker is retired and its key is revoked
      And a new worker is spawned carrying the new key
      And the new worker resumes the conversation's session

    # The outbox may re-send a turn after its answer was lost. Only the worker
    # that ran it remembers it; a fresh one would run it a second time.
    @unit
    Scenario: A re-sent turn the over-age worker already ran is not run again
      Given a worker past its max age has completed a turn
      When the same turn is sent again with a freshly minted key
      Then the manager keeps the worker that ran it
      And the turn is answered as already handled, not run again

    @unit
    Scenario: An over-age worker finishes its running turn before it is retired
      Given a worker past its max age is running a turn
      When the manager sweeps for workers to retire
      Then the worker is kept and its key is not revoked
      And the running turn completes on it
      And once it has been quiet between turns the worker is retired and its key revoked

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
        | is retired for reaching its max age            |
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
