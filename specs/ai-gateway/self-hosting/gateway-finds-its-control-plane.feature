Feature: The gateway finds its control plane whatever the install is called
  As someone self-hosting LangWatch,
  I want the AI Gateway to work whatever I name my install,
  so that picking a name is not a decision that quietly breaks the product.

  # Cross-references:
  #   specs/ai-gateway/self-hosting/personal-keys-deployment.feature — the
  #   rest of the self-hosted gateway path.
  #
  # Context. Every address the chart hands one component for reaching another
  # is derived from the install's own name, because that is what the cluster
  # names the services after. The gateway's route back to the control plane
  # was the one exception: it carried a fixed address that only resolved on
  # installs that happened to be named the same as ours.
  #
  # The failure it produced is silent and late. Every pod starts, every probe
  # is green, and nothing goes wrong until someone actually sends traffic:
  # the key cannot be resolved, the request is refused, and no usage is
  # recorded. Nothing in the install says why, and the operator's only clue
  # is that it works in the documentation and not on their cluster.

  Scenario: An install named something else still has a working gateway
    Given an operator installs LangWatch under a name of their own choosing
    When the gateway needs to reach the control plane
    Then it reaches the control plane of that same install
    And a request presented with a virtual key is served

  Scenario: An operator pointing the gateway elsewhere keeps that address
    Given an operator runs the gateway against a control plane outside this install
    When they tell the chart where that control plane is
    Then the gateway uses the address they gave
    And nothing the chart works out for itself overrides it

  # The derived address can only be right about the port if the port is the
  # one the chart serves the control plane on. Rather than derive an address
  # that resolves to a closed door, the install stops and says which value
  # the operator has to fill in.
  Scenario: An install that moves the control plane off its usual port is told to say where it went
    Given an operator serves the control plane on a port of their own choosing
    And they have not told the gateway where the control plane is
    When they install
    Then the install refuses to render
    And the refusal names the value they need to set
