Feature: Redis 7 is the oldest server a process starts against
  As an operator running LangWatch against my own Redis
  I want a process to refuse an older server at start, naming the version it found
  So that the queue never runs Lua scripts the server cannot load (Alex, 2026-10-20)

  The queue's Lua scripts declare Redis 7 script flags, which Redis 6 rejects. The boot-time
  readiness probe reads the server's version once, after its PING. Valkey 7.2 and later report a
  compatible Redis version, so they pass.

  @unit
  Scenario: A Redis older than 7.0 is refused at start
    Given a Redis server reporting version 6.2.14
    When the readiness probe runs at boot
    Then it rejects with a message naming 6.2.14 and the minimum, Redis 7.0 or Valkey 7.2
    And it never reports the server ready

  @unit
  Scenario: Valkey 7.2 or later is accepted at start
    Given a Valkey 8.1 server, which reports Redis version 7.2.4
    When the readiness probe runs at boot
    Then it reports the server ready
