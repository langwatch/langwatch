Feature: A staged job's id is its identity and its retry count rides on the message
  As an operator reading a queue and the rows a job writes downstream
  I want a job to keep one id for its whole life, however many times it is retried
  So that the id stays a name I can look up, a key a database can index, and a
  thing two workers can agree is the same job.

  # Decision: dev/docs/adr/080-staged-job-id-is-identity-not-state.md
  #
  # Why this exists — production, 2026-07
  #
  # A staged job id is `<eventId>/<jobType>/<jobName>`. Every retry APPENDED a
  # segment to it, and the terminal restage appended one stamped from the wall
  # clock, so a job that had been round the ladder wore its whole history:
  #
  #   event_…/subscriber/pm:langyConversation/r/12/r/16/r/24/r/1785261278310
  #
  # Three things are wrong with that.
  #
  #   1. It grows without bound. The value is a Redis zset member and a hash
  #      field, and it gains a segment per retry and per operator unblock.
  #
  #   2. It is not a function of the job. The last segment is `Date.now()`, so
  #      re-staging the same job twice produces two different ids and nothing
  #      downstream can tell a repeat from a new arrival.
  #
  #   3. It encodes state in a name. The retry count was READ BACK OUT of the
  #      id by counting segments, which is why the id had to keep growing in
  #      the first place — a name was doing a counter's job.
  #
  # To be clear about what this is NOT: the staged job id never leaves the
  # queue's own Redis keys. The btree index blowup that ran alongside this
  # investigation came from a process manager's own idempotency key, not from
  # here (`specs/event-sourcing/process-manager-inbox-key.feature`), and the
  # two are independent. This one is a queue-hygiene defect: an unbounded,
  # non-deterministic name that an operator cannot read and cannot look up.
  #
  # The segment existed to carry ONE reader: the ladder that runs when a job's
  # body cannot be decoded at all
  # (`specs/event-sourcing/groupqueue-decode-drop-durability.feature`). That
  # path could not consult the attempt stamped inside the payload — the payload
  # is exactly what it cannot read — so it counted the segments instead.
  #
  # It never had to. A staged value is `<prefix><headerLength>|<header><body>`,
  # and the header is plain inline JSON that sits in front of the body: it is
  # what the Lua dispatcher slices to route a job and what the ops dashboard
  # reads to describe a value it could not decode
  # (`specs/event-sourcing/payload-envelope.feature`). Queue machinery,
  # including the attempt, already travels in that header. So the count the
  # ladder needs is readable without touching the body, and can be advanced by
  # rewriting the header alone — leaving the body's bytes, and therefore the
  # stored copy that identical jobs share, untouched.
  #
  # The id is now only ever a name. It is computed once when the job is sent and
  # every later write — retry, exhaustion, poison park — reuses it verbatim. The
  # queue can afford that because a job's id is already removed from staging the
  # moment it is claimed, so a re-stage is always putting back something that is
  # not there, never colliding with something that is.
  #
  # One consequence has to be designed for rather than discovered: rotating the
  # id was also what stopped a worker's in-flight heartbeat from recognising the
  # job it had just re-staged. With the id reused, that heartbeat matches again,
  # and a heartbeat's job is to extend the group's hold for the full active
  # window — which would stretch a half-second backoff into a multi-minute
  # stall. So the heartbeat has to stop when the job's outcome is decided, not
  # when the worker finishes its bookkeeping.

  Background:
    Given a GroupQueue dispatching per-aggregate FIFO groups

  Rule: A retry records its attempt and re-stages together, or does neither

    # Removing the marker from the id removed a carrier, and one reader depended
    # on it more than the others: a re-staged SIBLING comes back with its
    # original message and no attempt of its own, so for that job the group's
    # retry chain is now the ONLY place the count lives.
    #
    # That makes a half-completed retry dangerous in a way it was not before. If
    # the chain write fails on a brief connection blip and the re-stage then
    # succeeds, the next claim led by such a sibling reads no attempt anywhere
    # and starts over: a bounded ladder becomes unbounded, and a fold that uses
    # the attempt to recognise a retry discards its record of what it already
    # applied and folds the same events twice. So the two writes are one step.

    @integration
    Scenario: A retry that cannot record its attempt does not re-stage the job
      Given a claimed job that fails with a retryable error
      When the queue cannot record the attempt on the group's retry chain
      Then the job is not re-staged as though it were on a fresh attempt

    @integration
    Scenario: A sibling-led claim after a retry still sees the attempt the ladder reached
      Given a group whose retry was re-staged alongside an untouched sibling
      When that sibling leads the next claim
      Then it is counted on the attempt the ladder had reached, not the first

  Rule: A staged job keeps one id from the moment it is sent

    @integration
    Scenario: A job's staged id names the event and the job, and nothing else
      Given a job sent for an event
      When its staged id is derived
      Then the id names the event, the job type and the job name
      And the id carries no retry marker and no timestamp

    @integration
    Scenario: A retried job is re-staged under the id it was dispatched under
      Given a claimed job that fails with a retryable error
      When the queue re-stages it with backoff
      Then it is re-staged under the id it was dispatched under, unchanged

    @integration
    Scenario: A job blocked after exhausting its retries keeps its staged id
      Given a claimed job that has used up its retry budget
      When the queue blocks the group and re-stages the job for inspection
      Then it is re-staged under the id it was dispatched under, unchanged

    @integration
    Scenario: A group parked by the poison guard keeps the staged id it parked on
      Given a claimed job whose group trips the poison guard
      When the queue parks the group with the value intact
      Then the value is re-staged under the id it was dispatched under, unchanged

    @integration
    Scenario: A job that rides the whole retry ladder ends under the id it started with
      Given a job that fails on every attempt in its retry budget
      When the ladder runs to its end and the group is blocked
      Then the job left in staging has the same id it was first sent with
      And an operator can find it by the id the producer knows

  Rule: The retry attempt travels on the message and is readable without the body

    @unit
    Scenario: A job sent for the first time carries no attempt on its message
      Given a job that has never been retried
      When its attempt is read from the message
      Then no attempt is reported
      And the ladder counts it as the first attempt

    @unit
    Scenario: A retried job's attempt is readable without fetching its body
      Given a re-staged job whose body is held outside the message
      When its attempt is read while the body is unreachable
      Then the attempt is reported from the message alone

    @unit
    Scenario: Advancing a job's attempt leaves its payload bytes untouched
      Given a staged job carrying an attempt
      When the queue advances that job to its next attempt
      Then the job's payload bytes are unchanged
      And the job still points at the same stored body

    @unit
    Scenario: Advancing a job's attempt does not split the body it shares with identical jobs
      Given several jobs whose payloads are identical and share one stored body
      When one of them is advanced to its next attempt
      Then they all still share the one stored body

    @unit
    Scenario: A job stays readable as its attempt count grows wider
      Given a staged job advanced through attempts of different digit widths
      When each one is read back
      Then every one is still readable and reports the attempt it was given

    @unit
    Scenario: A job in a format that predates the readable attempt reports no attempt rather than a wrong one
      Given a job staged in a format that keeps its attempt inside the body
      When its attempt is read from the message alone
      Then no attempt is reported
      And the reader does not fail

  Rule: The ladder for a body that cannot be read is bounded by what it can read

    @integration
    Scenario: The unreadable-body ladder counts the attempt the message carries
      Given a staged job whose message says which attempt it is on
      When its body cannot be fetched
      Then the ladder treats it as the next attempt after the one on the message

    @integration
    Scenario: The unreadable-body ladder falls back to the group's retry chain when the message cannot say
      Given a staged job in a format whose message cannot report an attempt
      And a group that has already been round the ladder several times
      When the job's body cannot be fetched
      Then the ladder counts the attempt from the group's retry chain instead

    @integration
    Scenario: The unreadable-body ladder takes the higher of the message and the group's chain
      Given a staged job whose message and whose group disagree about the attempt
      When its body cannot be fetched
      Then the ladder counts from whichever of the two is further along

    @integration
    Scenario: Every rung of the unreadable-body ladder advances the count the next rung reads
      Given a job whose body is unreachable on every attempt
      When the ladder runs
      Then each attempt is counted higher than the one before it

    @integration
    Scenario: The unreadable-body ladder records each attempt on the group's retry chain
      Given a job whose body is unreachable
      When the ladder re-stages it for another attempt
      Then the group's retry chain records that attempt too

    @integration
    Scenario: A job whose attempt can never be written to its message still gives up at the end of the budget
      Given a job in a format whose message cannot carry an attempt
      And a body that stays unreachable
      When the ladder runs
      Then it still gives up once the budget is spent
      And it does not retry the job forever

    @integration
    Scenario: A body that stays unreachable is given up on at the end of the ladder
      Given a job whose body stays unreachable for its whole retry budget
      When the budget runs out
      Then the job is given up on and counted as a transient-exhausted loss
      And the group is left free to run its next job

  Rule: Re-staging a job under its own id conserves the queue-depth count

    # `specs/event-sourcing/pending-counter-conservation.feature` owns the
    # invariant itself — one increment per job entering a group's staging set,
    # one decrement per job leaving it, total equals what is actually staged —
    # and is not restated here. What is new is only that a re-stage now reuses
    # the id: claiming a job removes it from staging before any re-stage can put
    # it back, so the same-id insert lands on a member that is genuinely absent
    # and the arithmetic is the one a distinct id already produced.
    #
    # Reusing the id does change one thing, and it is the reason this Rule
    # exists at all: a redelivery of the same event now lands on the SAME
    # staging member as the job that is waiting out a backoff, overwriting its
    # message. That is why the retry count can never be read from the message
    # alone (see the Rule above), and why the backoff has to be held by the
    # group's hold rather than by the job's own position in the queue.

    @integration
    Scenario: A redelivery of an event already waiting to retry does not double the queue depth
      Given a job waiting out its retry backoff
      When the same event is delivered again
      Then the queue holds one job for that event, not two
      And the queue depth still equals what is actually staged

    @integration
    Scenario: A redelivery that overwrites a waiting job's message does not reset its ladder
      Given a job waiting out its retry backoff part-way up its ladder
      When the same event is delivered again and overwrites its message
      Then the job's next failure is counted from where the ladder had reached
      And it is not given a fresh budget

    @integration
    Scenario: A redelivery arriving mid-backoff does not shorten the wait
      Given a job waiting out its retry backoff
      When the same event is delivered again before the backoff expires
      Then the job is not dispatched before its backoff was due
      And the wait is held by the group's hold, not by the job's queue position

  Rule: A retry waits the backoff it was given, not the active-slot timeout

    # Rotating the id was doing a second, undocumented job, and it has to
    # survive the rotation's removal.
    #
    # While a job runs, its worker beats a heartbeat that keeps the group's hold
    # alive for the full active window — several minutes. Rotating the id is
    # what stopped a late beat from being believed: it named the retired id, so
    # it no longer matched. With the id reused it matches again, and a single
    # late beat would extend the hold to the full active window AND push the
    # group's next-eligible time out with it — turning a sub-second backoff into
    # a multi-minute stall.
    #
    # So the heartbeat must be stopped BEFORE the re-stage is written, not after
    # the worker finishes tidying up. The ordering is the whole point: the
    # heartbeat and the re-stage travel the same connection and are served in
    # the order they are sent, so a beat that fires while the re-stage is still
    # in flight has already been sent behind it. Stopping the beat only once the
    # re-stage comes back is too late.

    @integration
    Scenario: A retried job is dispatched when its backoff expires, not an active window later
      Given a claimed job that fails with a short retry backoff
      When it is re-staged and the worker finishes its bookkeeping
      Then the job becomes eligible again when the backoff expires

    @integration
    Scenario: No heartbeat is sent after a job's re-stage has been sent
      Given a claimed job being re-staged for a retry
      When the worker publishes the re-stage and finishes its bookkeeping
      Then no heartbeat for that job is sent after the re-stage

    @integration
    Scenario: A worker's heartbeat stops extending a group's hold once the job's outcome is decided
      Given a claimed job whose outcome has been decided
      When the worker's remaining bookkeeping runs
      Then the group's hold is not extended past what the outcome asked for

  Rule: Unblocking a group clears every counter that outlived the block

    # An operator who unblocks is asking for another run, not for the ladder to
    # resume one rung from its end.
    #
    # The queue keeps several per-group counters that outlive a block, and
    # unblocking clears only some of them. It drops the poison guard's claim
    # strikes and the stored error; it leaves the retry chain (which decides how
    # many attempts remain) and the consecutive-failure streak (which decides
    # when to quarantine). So a group blocked by exhaustion comes back with no
    # attempts left AND a streak already at the quarantine threshold, and the
    # very first failure re-blocks it. Worse, whether it does depends on how long
    # the operator took to press the button, because the retry chain expires on
    # its own after a while.
    #
    # An unblock is an operator saying "try this again". Every counter that
    # decides whether trying is allowed belongs in that reset — and the same
    # goes for the other two ways an operator clears a group out. Draining and
    # dead-lettering both empty the group entirely, so a group later re-created
    # under that id is a new group in every respect except its name; letting it
    # inherit a spent retry chain or a failure streak from jobs that are no
    # longer there is the same defect wearing a different hat.

    @integration
    Scenario: A group unblocked after exhaustion retries instead of re-blocking on its first failure
      Given a group blocked after a job used up its retry budget
      When an operator unblocks it and the job fails once more
      Then the job is retried rather than the group being blocked again

    @integration
    Scenario: A group unblocked after exhaustion is not immediately re-quarantined by its old failure streak
      Given a group blocked after a long run of consecutive failures
      When an operator unblocks it and its next job fails once
      Then the group is not quarantined on that single failure

    @integration
    Scenario: A drained group id starts its next job on a fresh ladder
      Given a group blocked after a job used up its retry budget
      When an operator drains it and a new job arrives under the same group id
      Then that job gets the full retry budget
      And it is not quarantined by the drained group's failure streak

    @integration
    Scenario: A dead-lettered group id starts its next job on a fresh ladder
      Given a group blocked after a job used up its retry budget
      When an operator moves it to the dead-letter queue and a new job arrives under the same group id
      Then that job gets the full retry budget
      And it is not quarantined by the dead-lettered group's failure streak

    @integration
    Scenario: An unblocked group's fresh ladder does not depend on how long the operator waited
      Given two groups blocked after exhaustion
      When one is unblocked immediately and the other much later
      Then both get the same retry budget on their next run

  Rule: Jobs already staged under the old growing ids finish under them

    # This ships onto a live queue holding jobs whose ids already carry retry
    # segments. Nothing rewrites them: a worker uses whatever id it was handed,
    # so a legacy id keeps working as a name and simply stops growing.
    #
    # One class of in-flight job needs care. A job part-way up the ladder for an
    # unreadable body recorded its count ONLY in the id — that was the whole
    # reason the segments existed — so after this change neither its message nor
    # its group chain can say how far it got, and it would be handed a fresh
    # budget. To avoid resetting a fail-safe mid-flight, a trailing retry segment
    # is still READ as a last resort when neither of the other two can answer.
    # It is never written: a legacy id is a value to interpret on the way out,
    # not a format to keep alive.

    @integration
    Scenario: A job staged under a legacy retry-suffixed id still completes
      Given a job staged before this change, whose id carries retry segments
      When a worker claims and processes it
      Then it completes normally and leaves staging

    @unit
    Scenario: A legacy id's retry segment is read only when nothing else can answer
      Given a legacy id carrying a retry segment
      When the attempt is taken from a message that records one
      Then the message is believed and the id's segment is ignored

    @integration
    Scenario: A job staged under a legacy retry-suffixed id resumes its ladder rather than restarting it
      Given a job staged before this change, part-way through its retry budget
      And neither its message nor its group can say how far it got
      When it fails again after this change is deployed
      Then it is retried on the attempt after the one its id had reached
      And it is not given a fresh budget

    @integration
    Scenario: A legacy retry-suffixed id gains no further segments
      Given a job staged before this change, whose id carries retry segments
      When it is retried, exhausts its budget, and its group is parked
      Then its id is exactly the one it was dispatched under at every step
