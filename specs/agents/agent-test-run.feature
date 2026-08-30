Feature: Test agent with one scripted run
  As someone who set up an agent
  I want to send it one message through the same path a simulation takes
  So that I know the agent answers before I run scenarios against it

  # "Test agent" runs one scenario through the platform's own execution path:
  # the queued event, the execution pool, the child process and the adapter
  # of the agent's type. The conversation is written down: the user sends
  # "ping", the agent answers, and the run succeeds when the answer arrives.
  # No user simulator and no judge take part, so no model is resolved.
  #
  # Nothing is saved. The run carries a fixed scenario id with no row behind
  # it, and its batch lands in the project's agent test set,
  # __internal__<projectId>__agent-test, which the results lists leave out.

  Background:
    Given a project with an HTTP agent, a code agent and a connected agent

  # ---------------------------------------------------------------------------
  # Scheduling
  # ---------------------------------------------------------------------------

  Rule: A test run is a real run with nothing saved

    @unit
    Scenario: A test run is queued with no scenario saved
      When a test run of the HTTP agent is scheduled
      Then one run is queued against the agent
      And the run carries the agent test scenario id and the project's agent test set
      And no scenario, run plan or test suite is written

    @unit
    Scenario: The queued run names the agent
      When a test run of the HTTP agent is scheduled
      Then the run is named after the agent
      And its metadata records the agent as the target

    @unit
    Scenario: The child job of a test run carries the script and no model
      Given the prefetch of a run with the agent test scenario id
      When the job data is prepared
      Then it carries the scripted conversation with the message "ping"
      And it resolves no model for a simulator or a judge
      And no scenario row is read

    @unit
    Scenario: A child job with a script parses without model params
      Given a child job payload that carries a script and no model params
      When the child parses it
      Then the payload is accepted

    @unit
    Scenario: An agent that is not run by scenarios is refused
      When a test run of a prompt agent is scheduled
      Then the run is refused as not testable
      And nothing is queued

    @unit
    Scenario: An agent the run cannot be prepared from is refused
      Given an agent whose configuration the run cannot be prepared from
      When a test run of it is scheduled
      Then the run is refused with the preparation message
      And nothing is queued

  Rule: The run succeeds when the agent answers and fails when it does not

    @unit
    Scenario: The scripted run sends ping and succeeds on the answer
      When the child builds the cast of a scripted run
      Then the user's message is written down as "ping"
      And the agent under test is the only agent asked to speak
      And the run is marked successful after the answer

    @unit
    Scenario: The scripted user never improvises
      When the runner asks the scripted user for a message of its own
      Then the request is refused

    @unit
    Scenario: An offline connected agent fails the run
      Given a connected agent with no process connected
      When the scripted run calls it
      Then the run fails and the failure names the agent as offline

  # ---------------------------------------------------------------------------
  # Who can start a test run
  # ---------------------------------------------------------------------------

  Rule: A test run is started by the person who asked for it

    @unit
    Scenario: A personal development agent of someone else is refused
      Given a connected agent that belongs to another person
      When a test run of it is scheduled
      Then the run is refused as owner only
      And nothing is queued

    @integration
    Scenario: The mutation answers with the run ids
      When "Test agent" is requested for the HTTP agent through the API
      Then the answer carries the scenario run id and the batch run id
      And the run is queued in the project's agent test set

    @integration
    Scenario: The REST route schedules the same run
      When "POST /api/agents/:id/test" is called with a project key
      Then the answer carries the scenario run id and the batch run id

  # ---------------------------------------------------------------------------
  # Results lists and the run drawer
  # ---------------------------------------------------------------------------

  Rule: Test runs stay out of the results lists and open in the run drawer

    @unit
    Scenario: The agent test set is an internal set
      Given the set id "__internal__proj_1__agent-test"
      Then it is recognized as an internal set
      And it is recognized as an agent test set
      And it is not a suite set and not the on-platform set

    @integration
    Scenario: The results lists leave the agent test batches out
      Given a batch in the project's agent test set
      When the run plans, the results page and the run picker are listed
      Then the agent test batch is in none of them

    @integration
    Scenario: The run drawer opens a test run by its id
      Given a queued test run
      When the run drawer is opened with its scenario run id
      Then the run's state is read like any other run

  # ---------------------------------------------------------------------------
  # The agents page and the drawers
  # ---------------------------------------------------------------------------

  Rule: "Test agent" is one click away on every agent

    @integration
    Scenario: The card menu offers Test agent and opens the run drawer
      Given the agents page with an HTTP agent
      When "Test agent" is chosen from the card menu
      Then a test run is requested for that agent
      And the run drawer opens on the scenario run id it answered

    @integration
    Scenario: The connected agent row offers Test agent
      Given the agents page with a connected agent
      When "Test agent" is chosen from the row menu
      Then a test run is requested for that agent

    @integration
    Scenario: A refused test run is explained in the words of the registry
      Given the agents page with an agent that cannot be tested
      When "Test agent" is chosen from the card menu
      Then the refusal is shown with the registry's title and no raw message

  Rule: The drawer test panel sends "ping" by default

    @integration
    Scenario: The connected agent drawer sends one test turn
      Given an online connected agent
      When the test panel is opened
      Then the message reads "ping"
      And starting the test sends that turn and shows the answer with the instance that served it

    @integration
    Scenario: The HTTP and code agent drawers test a saved agent
      Given a saved HTTP agent and a saved code agent
      When either editor drawer is open
      Then the "Test agent" panel is shown below the form
      And starting the test sends one turn to the agent and shows the answer

    @integration
    Scenario: A draft has no test panel
      Given the HTTP agent editor drawer open for a new agent
      Then no "Test agent" panel is shown
