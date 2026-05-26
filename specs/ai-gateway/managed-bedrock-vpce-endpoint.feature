Feature: Managed-Bedrock dispatch through a customer VPC endpoint

  # Implemented in the Go gateway service (services/aigateway), out of scope
  # for the TS feature-parity check. Scenarios bind to Go _test.go tests.
  #
  # Some customers grant LangWatch managed Bedrock access through their own
  # PrivateLink VPC endpoint, and their IAM role only authorizes model
  # invocation when the request arrives via that endpoint. The gateway's
  # default Bedrock path sends requests to the public AWS endpoint, which the
  # customer's role rejects. When a Bedrock credential carries a runtime
  # endpoint, the gateway must send and sign the request for that endpoint so
  # the call traverses the customer's VPC endpoint and is authorized.

  Rule: A Bedrock credential carrying a runtime endpoint routes through it

    @integration
    Scenario: Chat request reaches and is signed for the customer endpoint
      Given a managed Bedrock credential that carries a runtime VPC endpoint
      When a chat request is dispatched for that credential
      Then the request is sent to the customer endpoint, not the public AWS endpoint
      And the response is returned as a normal chat completion

  Rule: Bedrock without a managed endpoint is unaffected

    @integration
    Scenario: A Bedrock credential without a runtime endpoint stays on the default path
      Given a Bedrock credential with no runtime endpoint configured
      When the gateway resolves the runtime endpoint for that credential
      Then no endpoint is resolved so dispatch stays on the default Bedrock path
