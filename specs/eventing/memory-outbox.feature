Feature: The memory stores drain outbox rows the way the live stores do
  As a developer running the installed list over memoryStores()
  I want every memory repository that writes outbox rows to write them where
  the eventing runtime reads them
  So that a memory stack and an installation test see the same facts a live
  stack records, without a hand drain

  # Live shares one Postgres between eventing and every module's process store.
  # The memory tier mirrors that with one InMemoryProcessStore owned by
  # memoryStores(), handed to eventing and to each memory registry (R41 A).

  Rule: One memory process store serves eventing and the module repositories

    @unit
    Scenario: The memory stores hold one process store for every reader
      Given the memory stores of a process
      When eventing and a module's memory repositories each ask for the process store
      Then both are answered with the same instance

    @integration
    Scenario: A user created on the memory stores records its created fact within one outbox poll
      Given the worker's installed list booted over memoryStores()
      When a user is created
      Then the user's created fact is recorded within one outbox poll
