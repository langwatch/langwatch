# The upgrade matrix (plan-upgrade-snapshots §2 and §5, ruling D3): every cell boots the release it
# upgrades from on its own upgradelab_<cell> stores, seeds it, switches the same stores to head's api
# and worker, and proves the new upgrade experience with traffic flowing through the switch.
# Harness: tools/upgradelab (`upgradelab cell`). Invariant ids are the plan's I0-I11 plus N1-N4, O1.

Feature: Every deployment upgrades to head with the api serving and nothing dropped
  As the maintainer shipping a release that migrates stored data
  I want each deployment, volume and data shape upgraded end to end under live traffic
  So that a deploy that drops a request, loses a write or leaves the ledger behind is found here first

  Background:
    Given a cell's stores are dedicated databases named upgradelab_<cell> and its own Redis
    And neither release's checkout holds a .env

  @e2e @unimplemented
  Scenario Outline: <deployment> at tier <tier> with <shape> data upgrades to head under traffic
    Given the old release of <deployment> runs on the cell's stores, seeded at tier <tier> with <shape> data
    And seeded traffic posts traces (OTLP and the collector), logs and metrics, and makes API and tRPC reads and writes
    When the old api and worker stop and head's api starts before head's worker
    Then the api serves every route from boot and reports ready once the ledger is current
    And head's worker ran the upgrade under the lease, with no manual upgrade run
    And the ledger is current on every ClickHouse target with nothing reopened after ready
    And no table holds fewer rows than it held at the cut, and every seeded product kind reads back through head
    And a second upgrade exits 0 and changes no ledger row
    And Ops > Upgrades shows the upgrade in progress and then "Up to date"

    Examples:
      | deployment  | tier | shape   |
      | cloud       | S    | typical |
      | hybrid      | S    | typical |
      | self-hosted | S    | typical |
      | cloud       | L    | typical |
      | hybrid      | L    | typical |
      | self-hosted | L    | typical |
      | cloud       | XL   | typical |
      | hybrid      | XL   | typical |

  @e2e @unimplemented
  Scenario: The api answers ingest before the upgrade is done
    Given a cell switching to head
    When head's api has started and its worker is still upgrading
    Then OTLP, collector, log and metric posts are answered 2xx before head reports ready
    And the report records the api's start, its first answered ingest and the upgrade's end

  @e2e @unimplemented
  Scenario: No call fails and no write is lost through the switch
    Given seeded traffic running from before the switch until after ready
    When a call is answered upgrade_in_progress (503 with Retry-After)
    Then the client retries it after Retry-After, and the cell counts the retry and its window
    When the cell settles
    Then every call eventually answered 2xx
    And no ingest call was ever answered a non-2xx
    And every write answered 2xx is visible after settle: spans, logs, metrics, prompts, prompt versions, datasets
    And the report counts sent, answered and stored per kind and the status codes per api phase

  @e2e @unimplemented
  Scenario: Work queued while no worker runs drains once head's worker starts
    Given the old worker paused at the cut with traffic still arriving
    When head's worker starts
    Then the queued work peaks and then drains to its baseline within the settle bound
    And the report records the peak depth and the drain time

  @e2e @unimplemented
  Scenario: A background step that fails is retried from Ops > Upgrades
    Given a cell whose background step fails on its first attempt
    When the operator presses Retry on Ops > Upgrades
    Then the step returns to pending, runs again and ends done
    And the page shows "Needs attention" before the retry and "Up to date" after it

  @e2e @unimplemented
  Scenario: Head's worker restarted mid-upgrade resumes from its checkpoint
    Given head's worker is killed while a blocking or background step runs
    When a new head worker starts
    Then it takes the lease and resumes the step from its checkpoint
    And the final fingerprint equals a clean run's

  @e2e @unimplemented
  Scenario: Head's api started long before its worker serves and never runs a step
    Given head's api is started with no head worker for a minute
    Then the api answers ingest 2xx, answers a Postgres read on an unmigrated schema upgrade_in_progress, and is not ready
    And the ledger records no step started by the api
    When head's worker starts
    Then the upgrade runs and the api reports ready

  @unit
  Scenario: A cell refuses a store it does not own
    Given a database name without the upgradelab_ prefix
    When a cell would create or drop it
    Then the cell refuses and names the prefix it owns

  @unit
  Scenario: A cell refuses a checkout that holds a .env
    Given a release checkout holding a .env at its root
    When a cell would boot it
    Then the cell refuses and names the file

  @unit
  Scenario: Every deployment profile routes to the cell's own stores
    Given each deployment profile
    When its environment is built for a cell
    Then every store URL names the cell's databases and its own Redis
    And a hybrid organization is routed to the cell's private ClickHouse database
    And no shape file's compose-network store URL survives

  @unit
  Scenario: Traffic is seeded and judged per kind and per api phase
    Given two runs with one seed
    Then each item's id is equal in both runs
    And a call answered 2xx whose write is not visible after settle counts as lost
    And a call with no answer counts as failed in the phase it was sent in
    And a call answered upgrade_in_progress is retried after Retry-After and counted with its retry window

  @unit
  Scenario: A cell claims its ledger row and reports its verdict to it
    Given a cell run with a tested-flow ledger row named
    When the cell starts and when it ends
    Then the row is claimed in progress at the start
    And at the end the row carries the status, who tested it, the date and the evidence, with no host or local path
    And one line naming the row and its failing invariants is added first under the log
    And no other row changes
