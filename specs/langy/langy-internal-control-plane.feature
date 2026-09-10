Feature: The Langy internal control plane keeps the addresses its two halves dial
  As the operator of a LangWatch deployment
  I want the app and the Go agent to keep dialling the same three addresses
  So that upgrading one half never silently strands the other

  `/api/internal/langy` is the control plane between two halves of one
  deployment: the agent's outbound calls back to the app, and the worker's
  inbound frame stream. It is not a customer contract, so it carries no dated
  namespace and no `/api/v1` twin — but the running agent dials these exact
  paths, so they are still a promise.

  The deployment's own shared bearer is checked by the DOOR, ahead of any
  handler, so a route whose author forgets a check still ships authenticated.

  Rule: The three addresses and their door are fixed

    @unit
    Scenario: The control plane publishes its three literal addresses
      Given the Langy internal control plane declaration
      When its addresses are read
      Then it serves the turn-result, credential-revoke and relay-frame paths literally

    @unit
    Scenario: Every route answers behind the deployment's own bearer
      Given the Langy internal control plane declaration
      When each route's door is read
      Then every one of them answers behind the deployment's shared secret and asks no permission

    @unit
    Scenario: The control plane publishes no dated twin
      Given the Langy internal control plane declaration
      When its addressing is read
      Then it is literal and carries no /api/v1 alias
