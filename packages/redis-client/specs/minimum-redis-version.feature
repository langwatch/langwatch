Feature: Redis 7 is the oldest server a process starts against
  As an operator running LangWatch against my own Redis
  I want a process to refuse an older server at start, naming the version it found
  So that the queue never runs Lua scripts the server cannot load (Alex, 2026-10-20)

  The queue's Lua scripts declare Redis 7 script flags, which Redis 6 rejects. The boot-time
  readiness probe reads the server's version once, after its PING. Valkey 7.2 and later report a
  compatible Redis version, so they pass. Only a version known to be too old is refused: a server
  that will not say its version starts with a warning.

  @unit
  Scenario: A Redis older than 7.0 is refused at start
    Given a Redis server reporting version 6.2.14
    When the readiness probe runs at boot
    Then it rejects as an unsupported version, naming the version 6.2.14 it found
    And it never reports the server ready

  @unit
  Scenario: Valkey 7.2 or later is accepted at start
    Given a Valkey 8.1 server, which reports Redis version 7.2.4
    When the readiness probe runs at boot
    Then it reports the server ready

  @unit
  Scenario: A server that reports no version starts with a warning
    Given a Redis server that answers PING but reports no version
    When the readiness probe runs at boot
    Then it warns that the version is unknown and 7.0 or later is required
    And it reports the server ready

  @unit
  Scenario: A server that refuses INFO starts with a warning
    Given a Redis server that answers PING but whose user may not run INFO
    When the readiness probe runs at boot
    Then it warns that the version is unknown and 7.0 or later is required
    And it does not report the server as unreachable
    And it reports the server ready
