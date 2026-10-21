Feature: The chart-managed Redis can run as Valkey
  As someone running LangWatch on my own cluster,
  I want to switch the bundled Redis to Valkey with one overlay,
  so that I can use it without changing anything else in my install.

  # Cross-references:
  #   charts/langwatch/examples/overlays/redis-valkey.yaml - the overlay.
  #   charts/langwatch/tests/redis-valkey.sh - renders the chart and asserts these.

  # The valkey/valkey:9.1 image ships redis-server and redis-cli, runs as uid 999
  # like the Redis image, so only the image changes. It cannot load a Redis 8.0
  # dump, so the overlay is for fresh installs: an existing release drains the
  # workers and starts empty (Redis here holds only queues and cache).

  Rule: The overlay changes the image and nothing else

    @e2e
    Scenario: The overlay runs the chart-managed Redis as Valkey
      Given the size-prod profile with the redis-valkey overlay
      When the chart renders
      Then the Redis StatefulSet runs the valkey/valkey image

    @e2e
    Scenario: Valkey runs with the same command and probes as Redis
      Given the size-prod profile with and without the redis-valkey overlay
      When the chart renders both
      Then the server command and the probes are identical

  Rule: Redis stays the default

    @e2e
    Scenario: Without the overlay the chart still runs Redis
      Given the size-prod profile alone
      When the chart renders
      Then the Redis StatefulSet runs the redis image
