Feature: The standalone API process composes its own authorization
  As an operator running a LangWatch API deployment
  I want the API process to build the authorization service it enforces with
  So that serving product traffic does not require a second process to hand it
  one

  # WHY THIS EXISTS
  #
  # `API_UNAVAILABLE_PRODUCT_ADAPTERS` named the grant command pipeline —
  # `AuthzGrantsCommandDispatcher` and `AuthzRevocationTelemetry` — as ports
  # whose only implementation lived with the legacy application. Neither was
  # actually the legacy application's to own. The telemetry needed a metric
  # registry, which this process now has. The dispatcher needed an Eventing
  # runtime with the grants pipeline registered, and the only thing that had
  # ever registered one was a process that also CONSUMED the shared queue.
  #
  # It does not have to. The worker claims `event-sourcing/jobs` and runs the
  # handlers; a command's routing key is stamped from the pipeline and command
  # names at send time, so where a command was produced is not a fact the
  # consumer needs. This process registers the SAME packaged definition the
  # worker installs, as a producer, over its own Group Queue.
  #
  # The definition is never forked. Two descriptions of one persisted event
  # stream is the one unacceptable way to have done this.

  Rule: A process with a database and its own dispatch composes AuthZ itself

    @unit
    Scenario: The API process composes its own AuthZ service
      Given the deployment configured a database and a Redis
      And no host supplied an AuthZ service
      When the process composes
      Then it builds both AuthZ services out of its own infrastructure
      And it mounts the product transports over the service it built

    @unit
    Scenario: The API process registers the packaged grants pipeline, not a copy
      Given the process is composing its own AuthZ service
      When it opens the ledger's write path
      Then it registers the packaged grants pipeline exactly once
      And the registration is a real pipeline rather than one that drops commands
      # One aggregate, one producer in this process. Registering twice would
      # give one grant two lanes.

  Rule: A host that owns the graph owns the service

    @unit
    Scenario: An injected AuthZ service is the one the process authorizes with
      Given a host supplies the API process with its own AuthZ service
      When the process composes
      Then requests are authorized by the host's service
      And the process composes none of its own
      # A second AuthZ graph in one process would give one organization two
      # permission caches and two epochs.

  Rule: A process that cannot compose AuthZ serves no product traffic

    @unit
    Scenario: A process with no database composes no AuthZ service
      Given the process has dispatch but no database
      When it tries to compose AuthZ
      Then it composes none, and names the missing half at boot

    @unit
    Scenario: A process with no dispatch composes no AuthZ service
      Given the process has a database but no Group Queue
      When it tries to compose AuthZ
      Then it composes none, and names the missing half at boot
      # A grant change would block for the ledger wait and then refuse. Saying
      # so at boot is the difference between reading it in the logs and
      # discovering it on the first membership change.

    @unit
    Scenario: A process that can compose no AuthZ mounts no product transports
      Given neither a host nor the deployment supplies an AuthZ service
      When the process composes
      Then it serves its lifecycle surface and mounts no product transports
      # Every product route on this process is authorized, so a route graph
      # over a missing AuthZ would be a route graph that cannot say no.
