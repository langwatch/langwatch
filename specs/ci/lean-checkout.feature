Feature: CI checkouts leave the marketing media on the server
  As a developer waiting on CI
  I want jobs to fetch only the tree they build against
  So that a dozen parallel checkouts do not each pull 175 MB they never read

  # docs/ and assets/ are the two largest directories in the repository and
  # hold none of CI's inputs: docs/ is 138 MB and assets/ 37 MB, almost
  # entirely .gif and .mp4 marketing media, against 81 MB for platform/ — the
  # thing we build. Naming a sparse-checkout makes actions/checkout fetch with
  # --filter=blob:none, so those blobs never cross the wire.
  #
  # Measured on a depth-1 clone of this repository:
  #   full      180 MB .git   490 MB tree   78s
  #   lean       39 MB .git   175 MB tree   15s
  #
  # It compresses the tail as well as the median, which is what actually sets
  # wall clock. In run 31396568900 the six integration shards spent 9s, 9s,
  # 10s, 19s, 151s and 185s in checkout; the job totals tracked it, 599s to
  # 891s for the same work.
  #
  # The rule is stated as an invariant over every checkout rather than a list
  # of the jobs that have one, because the failure mode is a new job added
  # without it: nothing breaks, CI just quietly gets slower again.

  Background:
    Given a workflow whose jobs build or test the application
    And a checkout step in one of its jobs

  @unit
  Scenario: A job that needs the working tree still leaves the media behind
    Given the checkout step reads working-tree content
    Then it declares a sparse-checkout that excludes "docs/" and "assets/"
    And it selects non-cone mode

  @unit
  Scenario: A gate job that reads no working tree takes only what it reads
    Given the checkout step belongs to a job that reads nothing outside ".github"
    Then it declares a sparse-checkout of ".github"
    And it is not required to name the media exclusions

  @unit
  Scenario: Cone mode is refused because it would drop a new top-level directory
    Given a checkout step that excludes the media
    Then it does not use cone mode
    # Cone mode takes an include list, so a directory added at the top level
    # would silently stop reaching CI until someone noticed. The negation form
    # says what we drop and lets everything else through by default.

  @unit
  Scenario: A new job added without the exclusion fails the check
    Given a job whose checkout step declares no sparse-checkout at all
    Then the invariant reports that job by name
