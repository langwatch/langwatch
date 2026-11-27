Feature: Agent call graph across A2A hops
  When one agent calls another, over A2A or in process, the trace shows
  which agents took part, the calls between them and what each agent spent.
  The graph is read per trace with traces:view, like the other drawer reads.

  Rule: Agents and calls

    @unit
    Scenario: Two agents across an A2A hop share one call graph
      Given a trace where the caller agent sends an A2A SendMessage to a remote agent
      And the remote agent's server spans join the trace through traceparent
      When the call graph is read for the trace
      Then it has a node for the caller and a node for the remote agent
      And one edge from the caller to the remote agent marked as A2A
      And the edge counts the call, its errors and its latency

    @unit
    Scenario: Each agent carries its own tokens and cost
      Given a two-agent A2A trace where both agents call an LLM
      When the call graph is read for the trace
      Then each node sums tokens and cost only from its own LLM spans

    @unit
    Scenario: A single-agent trace has one node and no edges
      Given a trace with spans from one agent only
      When the call graph is read for the trace
      Then it has one node holding every span and no edges

    @unit
    Scenario: A remote span whose parent is missing stays in the graph
      Given a trace where a remote agent's span names a parent that never arrived
      When the call graph is read for the trace
      Then the remote agent is a node flagged with a missing parent
      And no edge is invented for the missing caller

    @unit
    Scenario: A service without an agent name becomes its own node
      Given a trace where a child span runs in another service with no agent name
      When the call graph is read for the trace
      Then that service is a node and the call to it is an edge

    @unit
    Scenario: An HTTP span between the A2A client and an unnamed server keeps one remote agent
      Given an A2A client span that names its callee
      And an HTTP client span in the caller's service under it
      And an unnamed server span in another service under that
      When the agent call graph is built
      Then the server's spans and LLM usage belong to the callee
      And the graph has the caller, the callee and one A2A edge between them

    @unit
    Scenario: A plain call into a service that also hosts an agent keeps its own node
      Given an agent that calls one endpoint of a service with no agent below it
      And calls another endpoint of the same service that reaches a named agent
      When the agent call graph is built
      Then only the entry that reaches the agent folds into it
      And the plain call stays a call to the service node

    @unit
    Scenario: An Agent Card name and the server's own agent name stay one node
      Given an A2A client span naming the callee by its Agent Card name
      And the server span under it naming its agent differently
      When the agent call graph is built
      Then the callee is one node under the server's own agent name

    @unit
    Scenario: Open spans, deep chains and bad costs keep the graph sound
      Given a span with no end time, a very deep parent chain or a cost that is not a finite number
      When the agent call graph is built
      Then durations never go below zero, the chain resolves and the cost leaves the bad value out

  Rule: A2A span marks

    @unit
    Scenario: A2A spans are classified with their role, method, context, task and state
      Given spans with a2a attributes, an A2A JSON-RPC method name or an a2a.server span name
      When each span is classified
      Then each of them is an A2A call with its role, method, context, task and state
      And plain spans are not

    @unit
    Scenario: A gRPC call to another service with an A2A method name is not an A2A call
      Given a gRPC span whose rpc.method is SendMessage on a service that is not A2A
      When the span is classified
      Then it is not an A2A call
      And the same method on an A2A rpc.service is one

    @unit
    Scenario: Stock a2a-sdk span names are marked as A2A calls
      Given spans named the way the a2a-sdk traces its client transport and request handler
      When the spans are classified
      Then each is an A2A call with its role and its A2A method
      And the SDK's internal event queue spans are not

    @unit
    Scenario: Span tree nodes carry the agent name and the A2A mark
      Given a span naming its agent and a span marked as an A2A call
      When the span tree is read
      Then each node carries the agent name it names and whether it is an A2A call

    @unit
    Scenario: Both sides share one service.name and the client span names the callee
      Given a trace where the caller and the remote agent report the same service.name
      And the A2A client span names the callee from its Agent Card
      When the agent call graph is built
      Then the spans under the A2A client span belong to the callee agent
      And the graph has two nodes and one A2A edge

    @unit
    Scenario: An unnamed A2A client keeps the remote service as its own node
      Given a named agent whose A2A client span carries no callee name
      And the server span under it runs in another service
      When the agent call graph is built
      Then the remote service is its own node with its own LLM usage
      And the agent has an edge to it

    @unit
    Scenario: A single agent under an unnamed root span stays one node
      Given a root span with no agent name
      And one named agent under it in the same service
      When the agent call graph is built
      Then the graph has one node for that agent and no edges

    @unit
    Scenario: A braided span never sets the trace default service
      Given a braided trace whose first visible span comes from another project
      When the visible resources are taken
      Then the trace default service comes from the trace owner's own root span

  Rule: Agents view in the trace drawer

    @unit
    Scenario: The drawer reads the call graph only for a trace that may hold several agents
      Given a span tree naming one agent at most and holding no A2A call
      Then the Agents tab is hidden and the call graph is not read
      Given a span tree naming two agents, even in one service, or holding an A2A call
      Then the Agents tab shows, and the graph is read when the tab opens

    @integration
    Scenario: The agent call graph is read only once the Agents tab opens
      Given a trace whose Agents tab shows
      When the Agents tab is closed
      Then the call graph read is not enabled
      When the Agents tab opens
      Then the call graph is read

    @integration
    Scenario: A shared trace shows no Agents tab
      Given a read-only shared trace naming two agents
      Then the Agents tab is hidden and the call graph is not read

    @integration
    Scenario: The Agents tab stays open while the span tree loads and after a failed read
      Given the Agents tab is open
      When the span tree is still loading
      Then the tab does not switch back to the waterfall
      When the call graph read fails
      Then the tab stays and shows the failure

    @unit
    Scenario: The viz pane keeps the Agents view until the tab's visibility is final
      Given the Agents tab is selected and the span tree is still loading
      Then the viz pane keeps the Agents tab and its view, not the waterfall
      When the span tree has loaded and holds no second agent
      Then the viz pane drops the Agents tab and shows the waterfall

    @integration
    Scenario: The Agents pane shows a loading state and an error state with a retry
      Given the Agents tab is open
      When the call graph is loading
      Then the pane shows a loading state, not the waterfall
      When the call graph read fails
      Then the pane shows the failure with a retry

    @unit
    Scenario: The span tree labels only the spans the server marked as A2A calls
      Given span tree nodes the server marked as A2A calls and a local invoke_agent span
      Then only the marked spans carry the A2A label

    @integration
    Scenario: An A2A span is labelled in the span tree
      Given a span the server marked as an A2A call
      When the span tree renders
      Then its row carries an A2A label and other rows do not

    @integration
    Scenario: Each agent shows its LLM calls and tokens
      Given a call graph with an agent that made one LLM call
      When the Agents view renders
      Then the agent node shows its LLM call count and its prompt and completion tokens

    @unit
    Scenario: A one-agent call graph says so
      Given a call graph with one node
      Then the graph has a single agent
      Given a call graph with two nodes
      Then the graph has several agents

    @integration
    Scenario: The Agents tab stays when the graph finds one agent
      Given a trace with an A2A span and only one agent
      When the Agents tab opens and the graph loads with one node
      Then the Agents tab still shows, with the one node and a note that it is the only agent

    @unit
    Scenario: An A2A client span is read by its stored span kind
      Given a caller and an unnamed callee sharing one service
      And a client span named "send_message" with a2a attributes, span kind CLIENT and a2a.agent.name
      When the call graph is built
      Then the graph has two nodes and the callee's LLM cost sits on the callee

    @unit
    Scenario: Edge latency is the client side and edges with errors come first
      Given an A2A client span in the caller and a faster server span in the callee
      When the call graph is built
      Then the edge latency is the client span's duration
      And edges with errors come first, then the edges with the most calls

    @unit
    Scenario: A cycle keeps the root caller in the leftmost column
      Given agent A calls B and B calls A back
      When the graph is laid out
      Then A is in the first column and B in the second

    @integration
    Scenario: A wide fan-out keeps the agent nodes visible
      Given a call graph with one caller and 55 callees
      When the Agents view renders
      Then the node area does not shrink below its content and scrolls on its own

    @integration
    Scenario: Agent nodes show failed calls and the slowest callee
      Given a call graph whose callees differ in errors and latency
      When the Agents view renders
      Then a callee with failed calls has the error border and the slowest clean callee the warning border

    @unit
    Scenario: Shortcut 5 opens the Agents tab only when the tab shows
      Given a trace whose Agents tab is hidden
      Then pressing 5 does nothing and the shortcut help leaves Agents out
      Given a trace whose Agents tab shows
      Then pressing 5 opens the Agents tab

    @integration
    Scenario: Each agent shows its name and cost
      Given a call graph with two agents
      When the Agents view renders
      Then each agent node shows its name and cost

    @integration
    Scenario: An edge shows calls, errors, latency and the A2A label
      Given a call graph with an A2A edge
      When the Agents view renders
      Then the edge shows its call count, errors, latency and an A2A label

    @integration
    Scenario: Clicking an edge selects its first span
      Given a call graph with an edge
      When the edge is clicked
      Then the first span of that edge is selected
