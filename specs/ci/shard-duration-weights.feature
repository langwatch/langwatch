Feature: Shards are balanced by measured duration
  As a developer waiting on a test matrix
  I want each shard to carry the same amount of WORK, not the same number of bytes
  So that the run is not paced by one leg while another sits idle

  # The sequencer splits by longest-processing-time-first, which is only as good
  # as the number it is given for processing time. It used file size. Six
  # integration shards of near-identical file counts ran 547, 573, 595, 649, 726
  # and 766 seconds — the matrix paid 766 while a runner idled for three and a
  # half minutes. Bytes cannot see a file that is short but slow.
  #
  # Every shard computes the split independently in its own process and they
  # must agree exactly, or a file is dropped from the run or executed twice, and
  # either reads green. So the weights come from a file that arrives with the
  # checkout — never from a cache, a previous run, or anything a shard might
  # individually have.

  Rule: measured durations are preferred, and bytes are the fallback

    @unit
    Scenario: A file the manifest knows is weighed by its duration
      Given a manifest recording how long a test file took
      When that file is weighed
      Then the weight is the recorded duration

    @unit
    Scenario: A file added since the last refresh is weighed by its size
      Given a manifest that does not mention a test file
      When that file is weighed
      Then the weight is derived from its size

    @unit
    Scenario: A file added since the last refresh is comparable to a measured one
      Given a manifest whose files average a known cost per byte
      When a file the manifest does not mention is weighed
      Then its weight is scaled onto the same footing as the measured ones

    @unit
    Scenario: A file that cannot be read still lands in a shard
      Given a test file that cannot be stat'd
      When that file is weighed
      Then it is given a weight rather than dropped

  Rule: a manifest that cannot be trusted degrades to bytes rather than failing

    @unit
    Scenario: There is no manifest
      Given no manifest exists
      When the manifest is loaded
      Then it is empty
      And no error is raised

    @unit
    Scenario: The manifest is not valid JSON
      Given a manifest whose contents are not valid JSON
      When the manifest is loaded
      Then it is empty

    @unit
    Scenario: The manifest is a JSON array
      Given a manifest holding a JSON array
      When the manifest is loaded
      Then it is empty

    @unit
    Scenario Outline: An unusable duration is discarded rather than used as a weight
      Given a manifest recording <value> for a test file
      When the manifest is loaded
      Then that file is absent from the weights

      Examples:
        | value            |
        | zero             |
        | a negative number|
        | a string         |
        | null             |
        | infinity         |

  # Each shard emits ONLY the files it measured, and the aggregation lays those
  # deltas over the committed manifest. Having each shard merge over the
  # committed manifest instead would put the whole baseline in every artifact,
  # so a file measured by one shard would carry its new value in that shard's
  # artifact and its old value in all the others — and whichever artifact was
  # combined last would decide, discarding fresh measurements by file order.

  Rule: a refresh accumulates rather than replaces

    @unit
    Scenario: A shard reports only what it measured
      Given a run that measured two of the suite's files
      When the run writes its durations
      Then only those two files are written

    @unit
    Scenario: A shard never writes over the committed manifest
      Given a committed manifest of durations
      When a run writes its durations
      Then the committed manifest is untouched

    @unit
    Scenario: A shard refreshes only the files it ran
      Given a manifest holding durations for files this run did not execute
      When this run's durations are merged in
      Then the files it did not run keep their recorded durations

    @unit
    Scenario: A re-measured file takes its new duration
      Given a manifest holding a duration for a file
      When this run measures that file again
      Then the newer duration replaces the older one

    @unit
    Scenario: The manifest is written in a stable order
      Given durations measured in an arbitrary order
      When they are merged into the manifest
      Then the files are listed in sorted order
