Feature: Redis is an owned client, never a module singleton
  As an engineer working anywhere in the platform
  I want the Redis connection to be created by the composition root and handed out
  So that importing a module never opens a socket and never depends on boot order

  # WHY THIS EXISTS
  #
  # `src/server/redis.ts` created a live `IORedis`/`Cluster` at MODULE LOAD as an
  # import side effect, exported as `export let connection`. Anything that
  # imported it — a route, a service, a test, a file the browser bundle happened
  # to reach — opened a socket just by being imported.
  #
  # Three concrete costs paid for that:
  #
  #   1. The module needed a `shouldSkipRedis()` escape hatch reading raw
  #      `process.env` (NEXT_PHASE, BUILD_TIME, SKIP_REDIS, `typeof window`)
  #      because it could not be allowed to run in a build, a test, or a jsdom
  #      environment. Every one of those branches exists only because the work
  #      happened at import time.
  #   2. The app-layer could not use it — it built its OWN connection through
  #      `clients/redis.factory.ts`. The process therefore held TWO connections
  #      to the same Redis, and the factory carried a comment begging callers to
  #      keep its `db` index in sync with the singleton or the dev DB isolation
  #      became a split brain.
  #   3. Test files could not construct the unit under test without also
  #      constructing a Redis client, so ~20 of them carry
  #      `vi.mock("~/server/redis")` purely to stop an import from connecting.
  #
  # ClickHouse already had the answer: a pure `@langwatch/clickhouse-client`
  # package holding the contract, and the composition root owning the instance,
  # reached as `getApp().clickhouse`. This feature applies the same rule to Redis.
  #
  # See dev/docs/adr/093-redis-is-an-owned-client.md.
  # ADR-111 preserves this ownership rule while replacing the global App:
  # standalone API and worker processes own separate clients, while the
  # contributor-only combined parent may share one explicitly.

  Rule: The client package never connects as an import side effect

    @unit
    Scenario: Importing the package opens no connection
      Given the Redis client package
      When a consumer imports it
      Then no Redis connection is created
      And no environment variable is read

    @unit
    Scenario: A connection exists only when something asks for one
      Given the Redis client package
      When a caller invokes the connection factory with a Redis URL
      Then exactly one connection is created for that call

  Rule: Configuration is resolved from a supplied environment, never ambient

    @unit
    Scenario: Cluster endpoints are parsed into hosts and ports
      Given a cluster endpoint list of "one:6379,two:6380"
      When the configuration is resolved
      Then the endpoints are host "one" port 6379 and host "two" port 6380

    @unit
    Scenario: An endpoint without a port defaults to the Redis port
      Given a cluster endpoint list of "solo"
      When the configuration is resolved
      Then the endpoints are host "solo" port 6379

    @unit
    Scenario: A database index outside the valid range falls back to zero
      Given a database index of "99"
      When the configuration is resolved
      Then the database index is 0

    @unit
    Scenario: A database index is honoured in standalone mode
      Given a database index of "3"
      And a Redis URL
      When the configuration is resolved
      Then the database index is 3

    @unit
    Scenario: Cluster mode reports that a database index cannot apply
      Given a database index of "3"
      And a cluster endpoint list
      When the configuration is resolved
      Then the resolution warns that cluster mode supports only database 0
      And the database index is 0

    @unit
    Scenario: No Redis configuration means no client is asked for
      Given neither a Redis URL nor a cluster endpoint list
      When the configuration is resolved
      Then the resolution reports that Redis is not configured

    @unit
    Scenario: Redis is skipped when the caller disables it
      Given a Redis URL
      And Redis is explicitly disabled
      When the configuration is resolved
      Then the resolution reports that Redis is not configured

  Rule: Transport security follows the configured URL

    @unit
    Scenario: A rediss URL connects over TLS
      Given a Redis URL using the rediss scheme
      When a connection is created
      Then the connection uses TLS

    @unit
    Scenario: A URL asking to skip certificate verification is honoured
      Given a Redis URL that disables certificate verification
      When a connection is created
      Then the connection uses TLS without verifying the certificate

    @unit
    Scenario: A plain redis URL connects without TLS
      Given a Redis URL using the redis scheme
      When a connection is created
      Then the connection does not use TLS

  Rule: Readiness is a probe the caller owns, never a process exit

    @unit
    Scenario: A responsive Redis is reported ready
      Given a connection that answers a ping
      When readiness is probed
      Then the probe succeeds

    @unit
    Scenario: An unresponsive Redis fails the probe rather than the process
      Given a connection that never answers a ping
      When readiness is probed with a timeout
      Then the probe rejects with a timeout error
      And the process is not terminated

    @unit
    Scenario: Probing without a connection succeeds trivially
      Given no connection
      When readiness is probed
      Then the probe succeeds

    @unit
    Scenario: A credential in the Redis URL never reaches the logs
      Given a Redis URL carrying an authentication password
      When readiness is probed
      Then the log names the host and port it dialled
      And the password appears in no log field

  Rule: The application owns exactly one connection

    @unit
    Scenario: The composition root exposes the connection it created
      Given an initialized application configured with Redis
      When a caller reads the Redis client from the application
      Then it is the same connection the composition root created

    @unit
    Scenario: An application without Redis exposes no client
      Given an initialized application configured without Redis
      When a caller reads the Redis client from the application
      Then no client is returned

    @unit
    Scenario: Closing the application closes the connection
      Given an initialized application configured with Redis
      When the application closes
      Then the Redis connection is disconnected

  Rule: No module in the platform holds a Redis connection at module scope

    @unit
    Scenario: The retired singleton module is gone
      Given the platform source tree
      When a consumer looks for a module exporting a ready-made Redis connection
      Then no such module exists

    @unit
    Scenario: Nothing constructs a Redis client outside the client package
      Given the platform source tree
      When every construction of an ioredis client is located
      Then each one is inside the Redis client package or a test fixture

    # The guard is only as good as the file list it runs over, and a shortfall
    # there is silent: fewer files scanned, nothing found, green. Naming three
    # trees to walk left scripts, end-to-end specs and build tooling unscanned,
    # and reading only the TypeScript extensions left the JavaScript modules in
    # the scanned trees unread — two scripts constructed ioredis directly with
    # CI passing. Scanning is therefore a claim the suite makes about itself.
    @unit
    Scenario: The scan covers every tree and every module extension
      Given the platform source tree
      When the set of files the guard scans is inspected
      Then it includes the scripts, end-to-end and build-tooling trees
      And it includes modules written in JavaScript as well as TypeScript
      And it excludes installed dependencies

  Rule: Consumers reach Redis by injection or from the application

    @unit
    Scenario: A service receives its connection as a dependency
      Given a service that needs Redis
      When it is constructed
      Then its connection is supplied by the caller

    @unit
    Scenario: A request handler resolves the connection when it runs
      Given a request handler that needs Redis
      When the module is imported
      Then no connection is resolved
      When the handler runs
      Then it resolves the connection from the application

    @unit
    Scenario: A consumer degrades when the application has no Redis
      Given an application configured without Redis
      When a consumer that needs Redis runs
      Then it takes its documented fallback path rather than throwing

  Rule: A degraded write is allowed, but it is never silent

    # Resolving the connection per call rather than once at import introduced a
    # state the old singleton did not have: a callback running with no
    # connection, before the application boots or in a process that never
    # builds one. Sign-in rate-limit counters live only in this storage, so a
    # write dropped there is a rate limit that fails OPEN. The degrade is the
    # right behaviour — failing the request outright would be worse — but a
    # security control quietly turning itself off is not something an operator
    # should have to infer.

    @unit
    Scenario: A read with no connection degrades to a cache miss
      Given a session store backed by the application's Redis
      And a process with no application
      When the store reads a key
      Then it answers with a miss rather than raising
      And nothing is reported, because the caller recovers from the database

    @unit
    Scenario: A dropped write is reported rather than silently discarded
      Given a session store backed by the application's Redis
      And a process with no application
      When the store writes or deletes a key
      Then the drop is logged with the operation and a running count of drops
      And the key is absent from the report, because it is a credential

    @unit
    Scenario: A dropped write does not fail the request that caused it
      Given a session store backed by the application's Redis
      And a process with no application
      When the store writes a key
      Then the write completes rather than raising

    @unit
    Scenario: A deployment with no Redis drops writes the same way
      Given a session store backed by the application's Redis
      And an application configured without Redis
      When the store writes a key
      Then the drop is reported exactly as it is for a missing application

    @unit
    Scenario: Secondary storage reads and writes the application's connection
      Given a session store backed by the application's Redis
      And an application holding a Redis connection
      When the store reads, writes and deletes a key
      Then every operation reaches that connection under the store's namespace
      And no drop is reported
