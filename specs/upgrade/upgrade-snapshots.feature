# Upgrade snapshots (plan-upgrade-snapshots §4, lane L1 SNAP-FORMAT): the format a captured system
# state travels in, and the guards around it. The tool is tools/upgradelab (ruling D3); restore
# lives inside it and refuses the developer's own stack (ruling D7). Snapshots are public (D6), so
# the scrub refuses any secret before a snapshot is written.

Feature: A system state is captured to a snapshot and restored from it unchanged
  As the maintainer testing an upgrade from a real old state
  I want the stores of a stack captured to portable files and restored into fresh databases
  So that every upgrade cell starts from the same logical content, with no secret inside

  @unit
  Scenario: A round trip gives an equal fingerprint
    Given a Postgres, ClickHouse and Redis state with rows in several tables
    When the state is captured to a snapshot and restored into empty dedicated stores
    Then the fingerprint of the restored stores equals the fingerprint of the captured ones
    And the fingerprint does not depend on the order rows were written in

  @unit
  Scenario: Materialized views are created after data, so restored rows are not counted twice
    Given a ClickHouse target with a table and a materialized view that copies its rows to another table
    When the target is captured and restored
    Then the restore creates tables, then loads data, then creates the views
    And the view's destination table holds exactly the rows it held when captured

  @unit
  Scenario: Restoring a dump from schema mydb into schema public carries the ledger schema with it
    Given a Postgres dump taken from schema "mydb" with its ledger in "mydb_upgrade_ledger"
    When it is restored into a database whose schema is "public"
    Then schema "mydb" is renamed to "public"
    And schema "mydb_upgrade_ledger" is renamed to "public_upgrade_ledger"

  @unit
  Scenario: Restore refuses a database that is not empty or not dedicated
    When a restore targets a database whose name does not start with "upgradelab_"
    Then it refuses, naming the dedicated prefix
    When a restore targets a dedicated database that already holds tables
    Then it refuses, naming the database as not empty
    And nothing is written to either database

  @unit
  Scenario: Scrub refuses a planted provider key, naming table and column but never the value
    Given a captured table "ModelProvider" whose column "customKeys" holds an "sk-" style key
    When the snapshot is scrubbed
    Then the scrub refuses
    And the refusal names "ModelProvider" and "customKeys"
    And the refusal does not contain the key
    And an exact test value from the shape's allowlist is not a finding

  @unit
  Scenario: A manifest missing a field is refused
    Given a snapshot.json without the field "anchor"
    When the manifest is read
    Then it is refused, naming "anchor"
    And a manifest with every field the schema requires is accepted

  @unit
  Scenario: S3 objects travel with their keys, and a planted key in a body is refused
    Given a bucket holding objects under nested keys, one of them binary
    When the bucket is captured and restored into an empty bucket named "upgradelab-objects"
    Then every key and body is restored unchanged and the fingerprints are equal
    And a restore into a bucket not named "upgradelab-" is refused, naming the prefix
    And an object body holding an "sk-" style key is refused, naming the object key but never the value

  # The S3 client (lane UPGRADELAB-S3): hand-rolled SigV4, no SDK, path-style or virtual-host addressing.

  @unit
  Scenario: Capture lists and reads every object in an S3 bucket
    Given an S3 bucket holding more objects than one list page returns
    When the bucket is captured through the signed S3 client
    Then every page of the listing is followed to its end
    And every object is read and counted in the manifest

  @unit
  Scenario: Restore into S3 refuses a bucket whose name lacks the upgradelab- prefix
    Given an S3 bucket named "langwatch"
    When a snapshot is restored into it through the S3 client
    Then the restore refuses, naming the dedicated prefix
    And no object is written to the bucket

  @unit
  Scenario: Restore into S3 refuses a bucket that is not empty
    Given an S3 bucket named "upgradelab-objects" that already holds an object
    When a snapshot is restored into it through the S3 client
    Then the restore refuses, naming the bucket as not empty
    And no object is written to the bucket

  @unit
  Scenario: A signing failure or a refused request names the bucket and key, never the credentials
    When the S3 client has no secret key to sign with
    Then the request is not sent
    And the error names the bucket and the key
    When the S3 server answers 403 with a body that echoes the request signature
    Then the error names the bucket, the key and the status code
    And the error contains neither the access key, the secret key nor the signature
