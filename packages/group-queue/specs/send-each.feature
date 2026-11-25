Feature: Staging many payloads as single sends, in bounded batches
  As a producer handing the queue many independent jobs from one request
  I want each job staged exactly as its own send would stage it, but in few script calls
  So that Redis spends less time per job without changing scores, dedup, audit or recovery.

  # Why this exists: dev/docs/plans/redis-queue-perf.md, slice P1a.
  #
  # The single-job stage script was about half of all queue script CPU on a load test, one run
  # per job. `sendEach` prepares every payload as `send` does and stages them through the batch
  # script, at most 64 jobs and a byte ceiling per call, answering each payload at its position.
  # `sendBatch` keeps its own meaning: it adds the payload's index to its score and audits all.

  Background:
    Given a GroupQueue producer with Lua scripts deployed

  Rule: Each payload keeps what its own send would give it

    @integration
    Scenario: A batch of single sends leaves the same queue state as the sends one by one
      Given payloads with equal scores, repeated staged ids and dedup ids
      When they are staged once one at a time and once as one batch of single sends
      Then both leave the same jobs, scores, bodies, dedup keys and pending count

    @integration
    Scenario: Every dedup flag behaves in a batch as it does for a single send
      Given a staged job whose dedup id a later payload repeats
      When the later payload arrives with replace, extend or survive-dispatch set or unset
      Then the batch keeps or replaces the body, moves or keeps the score, and squashes as a single send does

    @integration
    Scenario: A batch arriving at a running or blocked group leaves its ready score alone
      Given a group that is running and a group that is blocked
      When a batch of single sends stages jobs into both
      Then neither group's ready score is lowered, as a single send would leave it

    @unit
    Scenario: A batch of single sends keeps each payload's own score
      Given payloads whose scores are equal
      When they are staged as a batch of single sends
      Then each job is staged at its own score, with nothing added for its position

  Rule: Each payload gets its own answer, at its position

    @unit
    Scenario: A payload the queue refuses fails alone
      Given a batch where one payload cannot be prepared
      When the batch is staged
      Then that payload is answered as rejected and every other payload is staged

    @unit
    Scenario: A deduplicated payload is answered as deduplicated and opens no audit row
      Given a batch where the queue squashes one payload into a job already staged
      When the batch is staged
      Then that payload is answered as deduplicated and only the staged payloads are audited

    @integration
    Scenario: A batch whose reply was lost is unknown and safe to send again
      Given a batch Redis staged but whose reply never reached the producer
      When the producer sends the same payloads again with the same identities
      Then the queue holds each job once and the pending count is unchanged

  Rule: A batch is bounded

    @unit
    Scenario: A batch never carries more than 64 jobs or its byte ceiling in one script call
      Given more payloads than one script call may carry
      When they are staged as single sends
      Then they travel in input order, in calls of at most 64 jobs within the byte ceiling
      And a single job larger than the ceiling travels alone

    @unit
    Scenario: A batch of single sends is refused once the drain has finished
      Given a queue whose drain has finished
      When a producer stages a batch of single sends
      Then it is refused, naming the finished drain
