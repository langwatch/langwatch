Feature: The no-redis-keyspace-scan lint rule
  A Redis SCAN reads every key in the database whatever MATCH says, so a walk
  on a live path stalls with the keyspace's size (packages/group-queue/adrs/
  092-tenant-claims-index.md). A live path reads an index its owner writes; a
  budgeted, paced walk is named in the rule's allowlist with its reason.

  @unit
  Scenario: A keyspace scan on a live path is reported
    Given a live-path file calling redis.scan with "MATCH" and "COUNT" arguments
    When the no-redis-keyspace-scan rule runs over it
    Then it reports keyspaceScan on the call's line, naming scan

  @unit
  Scenario: Unrelated scan methods are left alone
    Given scanner.scan(), recognizer.scan(text), adapter.scan(prefix), Object.keys(row) and map.keys() calls
    When the no-redis-keyspace-scan rule runs over them
    Then it reports nothing

  @unit
  Scenario: An allowlisted paced walk is left alone
    Given a scan with MATCH and COUNT in packages/group-queue/src/blobSweeper.ts
    When the no-redis-keyspace-scan rule runs over it
    Then it reports nothing

  @unit
  Scenario: A bare cursor scan on a Redis client is reported
    Given redis.scan(cursor), this.redis.scan(cursor), connection.scanBuffer("0") and redis["scan"](cursor) calls
    When the no-redis-keyspace-scan rule runs over them
    Then it reports keyspaceScan on each call

  @unit
  Scenario: A keyspace walk in any other spelling is reported
    Given a scan with an options object or a template-literal MATCH, a scanBufferStream, a scanIterator, redis.keys("gq:*"), redis.call("SCAN", ...) and conn.scan(cursor)
    When the no-redis-keyspace-scan rule runs over them
    Then it reports keyspaceScan on each call

  @unit
  Scenario: A SCAN or KEYS inside a Lua script is reported
    Given a Lua source string calling redis.call("SCAN", ...) and a template calling redis.call('KEYS', ...), one with a space before the bracket
    When the no-redis-keyspace-scan rule runs over them
    Then it reports luaKeyspaceScan on each, naming the command

  @unit
  Scenario: A test file may walk the keyspace
    Given a test file calling redis.scan with "MATCH"
    When the no-redis-keyspace-scan rule runs over it
    Then it reports nothing
