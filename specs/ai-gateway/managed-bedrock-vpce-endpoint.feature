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

  Rule: OpenAI models on Bedrock are served with plain model invocation access

    # OpenAI models on Bedrock (gpt-5.x through the global.openai.* inference
    # profiles, gpt-oss) are also served by a second endpoint, bedrock-mantle,
    # which needs its own IAM permission. A Bedrock credential is normally
    # granted bedrock:InvokeModel only, so the gateway serves these models
    # through the Converse API on the regional runtime endpoint.

    @integration
    Scenario: OpenAI models on Bedrock are served through Converse with InvokeModel access
      Given a Bedrock credential with no runtime endpoint and InvokeModel access only
      When a chat request for "global.openai.gpt-5.5" is dispatched for that credential
      Then the request is sent to the regional Bedrock runtime endpoint through Converse
      And it is not sent to the bedrock-mantle endpoint
      And other Bedrock models stay on the default path

    # OpenAI models on Converse take the Responses API shape for structured
    # output: gpt-5.5 ignores a chat-completions response_format and gpt-6
    # refuses it as an unknown parameter.
    @unit
    Scenario: Structured output on an OpenAI model on Bedrock is enforced through Converse
      Given a chat request for "global.openai.gpt-5.5" with a json_schema response format
      When the Converse request is built
      Then the schema is sent as text.format
      And a json_schema for gpt-oss, which does not enforce it, is refused

  Rule: The conversation reaches Converse in the turn order it requires

    # Converse allows only user and assistant messages, in alternation, and
    # every tool result answering one assistant turn must sit in the next user
    # message. A chat-completions conversation sends one tool message per
    # result, so the mapping merges them. Converse refused the second result
    # of a parallel tool call otherwise ("Expected toolResult blocks at
    # messages.2.content for the following Ids: call_b2").

    @unit
    Scenario: Results of parallel tool calls answer the assistant turn in one user message
      Given an assistant turn that made two tool calls and the two tool results that answer them
      When the Converse request is built
      Then both tool results sit in one user message, in the order they were sent

    @unit
    Scenario: User text right after tool results joins their user message
      Given a tool result followed by a user message
      When the Converse request is built
      Then the user text follows the tool result in the same user message

    @unit
    Scenario: Consecutive same-role messages merge into one Converse message
      Given two user messages in a row and two assistant messages in a row
      When the Converse request is built
      Then each pair becomes one message carrying both contents

    @unit
    Scenario: Assistant text comes before its tool uses
      Given an assistant message with text and two tool calls
      When the Converse request is built
      Then the assistant message carries the text first and then both tool uses

    @unit
    Scenario: An empty assistant message does not leave two user messages adjacent
      Given an assistant message with no content between two user messages
      When the Converse request is built
      Then the empty message is dropped and the two user messages merge

    @unit
    Scenario: A system message mid-conversation joins the system prompt
      Given a system message between two user messages
      When the Converse request is built
      Then its text joins the system prompt and the two user messages merge

    @unit
    Scenario: A tool result with no output still carries a content block
      Given a tool result whose content is empty
      When the Converse request is built
      Then the tool result carries one empty text block, since Converse requires its content

  Rule: A Bedrock refusal keeps its status

    # The Converse lane wrapped every Bedrock error in a 502 provider_error,
    # so a deterministic 400 ValidationException read as a retryable outage
    # and clients retried it until they gave up.

    @unit
    Scenario: A Bedrock refusal reaches the client under its own status
      Given Bedrock answers a Converse call with a 400 ValidationException
      When the gateway returns the error
      Then it carries status 400 and the error type "ValidationException"

    @unit
    Scenario: A request the SDK refuses to send is a bad request
      Given the Bedrock SDK refuses a Converse request for a missing required field
      When the gateway returns the error
      Then it is a "bad_request", which is neither retried nor failed over

    # A stream already answered 200 has no status to forward, so the status
    # Bedrock gives the exception on a plain call is what the trace records.
    @unit
    Scenario: A mid-stream Bedrock exception names its type and status
      Given a ConverseStream ends with a ThrottlingException
      When the gateway reports the stream error
      Then the error type is "ThrottlingException" and the status is 429
      And an Anthropic client reads it as a rate_limit_error with the exception name in its message
