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

  Rule: A2A span marks

    @unit
    Scenario: A2A spans are marked so the span tree can label them
      Given spans with a2a attributes, an A2A JSON-RPC method name or an a2a.server span name
      When the call graph is read for the trace
      Then each of them is listed as an A2A span with its role, method, context, task and state
      And plain spans are not listed

    @unit
    Scenario: Both sides share one service.name and the client span names the callee
      Given a trace where the caller and the remote agent report the same service.name
      And the A2A client span names the callee from its Agent Card
      When the agent call graph is built
      Then the spans under the A2A client span belong to the callee agent
      And the graph has two nodes and one A2A edge
