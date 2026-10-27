Feature: The app's and the worker's JavaScript heap follows its container memory limit
  As someone running LangWatch on my own cluster,
  I want the app and the worker to use the memory their containers are given,
  so that a heavy request or job does not kill them with half their memory unused.

  Node sizes its JavaScript heap at about half the memory it can see. A worker
  limited to 4Gi therefore had a heap ceiling near 2 GiB while it idled at 1.6 to
  2.0 GiB, and one large evaluation took it past the ceiling with 2 GiB of its
  container still free. A ceiling at three quarters of the limit leaves a quarter for
  memory outside the heap: buffers, sockets and the runtime itself. The app gets the
  same ceiling, since the worker is given everything the app is given.

  # Verified by rendering the chart: tools/chartheap (go run ./cmd/chartheap in the chart workflow)
  # (template: langwatch.heapCeilingEnv in templates/_helpers.tpl).

  Rule: The ceiling follows the memory limit

    @e2e
    Scenario: The app and the worker with a memory limit get a heap of three quarters of it
      Given the app and the workers have a memory limit
      When the chart renders
      Then each is started with a heap ceiling of 75 percent of its memory

    @e2e
    Scenario: With no memory limit the app and the worker keep Node's own heap size
      Given the app and the workers have no memory limit
      When the chart renders
      Then neither is started with a heap ceiling of the chart's

  Rule: The operator stays in charge

    @e2e
    Scenario: The operator's own Node options win
      Given the operator sets NODE_OPTIONS in the app's or the workers' extra environment
      When the chart renders
      Then each process that gets that environment starts with the operator's NODE_OPTIONS as its only one
