@unit
Feature: llmsim, a local LLM provider stand-in run by haven
  The playground, evaluators, scenario runs and Langy all call a model. llmsim
  answers those calls on a laptop from a seeded Markov chain, in the OpenAI and
  Anthropic wire formats the gateway and LiteLLM really speak, so a stack can
  exercise every model path for $0 and get the same answer for the same prompt.
  It accepts any key and checks none: it is a dev shim.

  # Bound by Go tests in services/llmsim/llmsim_test.go and
  # tools/thuishaven/domain/overlay_llm_test.go and tools/thuishaven/app/plan_llm_test.go, by their `// @scenario`
  # annotations. The playground scenario waits on a browser run against a stack.

  Scenario: The same prompt gets the same answer
    Given llmsim is running
    When a client sends the same chat completion twice
    Then both answers carry the same text and plausible token usage
    And a different prompt gets a different answer

  Scenario: A seed header pins or varies the answer
    When two different prompts carry the same X-Llmsim-Seed value
    Then they get the same answer
    And calls carrying X-Llmsim-Seed "random" get different answers

  Scenario: max_tokens caps the answer
    When a chat completion asks for at most 3 tokens
    Then the answer has at most 3 words, reports at most 3 completion tokens and finishes with "length"

  Scenario: Streaming uses each provider's SSE framing
    When a client streams a chat completion with include_usage
    Then it receives chat.completion.chunk events whose content joins to the unstreamed answer
    And a usage chunk, then "data: [DONE]"
    And an Anthropic messages stream runs message_start, content blocks, message_delta and message_stop

  Scenario: A forced tool is called with arguments built from its schema
    When a chat completion offers a tool and requires a tool call
    Then the answer calls that tool with JSON arguments that satisfy its parameters schema
    And the same request gives the same arguments

  Scenario: Tools mode calls a tool on an auto tool choice
    Given the model name contains "tools" or the call carries X-Llmsim-Tools "auto"
    When a chat completion offers tools with an auto tool choice
    Then the answer calls one of them with schema-valid arguments
    And the same request picks the same tool

  Scenario: Tools mode calls the tool the user message names
    Given the model is "markov-tools"
    When the last user message mentions an offered tool's name
    Then the answer calls that tool

  Scenario: Tools mode answers text after a tool result
    Given the model is "markov-tools"
    When the last message is a tool result, over chat completions, responses or messages
    Then the answer is text with no tool call

  Scenario: A json_schema response satisfies the schema
    When a chat completion asks for a json_schema response format
    Then the answer is JSON with every required key, formats, bounds, enums, consts and $ref types honoured
    And the same request gives the same JSON while a different prompt gives different JSON

  Scenario: A json_object response follows the fields its prompt names
    When a chat completion asks for a json_object response format and the prompt lists **bold** field names or embeds a JSON schema
    Then the answer is a JSON object with those fields, a list for a field whose line asks for a count range or a list
    And the same request gives the same JSON
    And a json_object request whose prompt names no fields still answers {"answer": ...}

  Scenario: Embeddings come back at the requested dimension
    When a client asks for embeddings of two inputs at 64 dimensions
    Then it gets two 64-dimension vectors, each a function of its input alone
    And base64 encoding answers little-endian float32 bytes

  Scenario: A forced error answers in the provider's shape
    When a model name contains "error-429"
    Then llmsim answers 429 with Retry-After and an OpenAI rate_limit_error body
    And an X-Llmsim-Error 500 header on a messages call answers an Anthropic error body

  Scenario: Langy mode echoes a plain message
    Given the model is "langy-echo" or the call carries X-Llmsim-Mode "langy"
    When the last user message is plain text
    Then the answer is that text verbatim, streamed or not

  Scenario: Langy mode makes the tool calls the message names
    When the last user message holds "/tool <name> <json args>" lines
    Then the answer makes exactly those tool calls with exactly those arguments, in order
    And any other lines become the answer's text

  Scenario: Langy mode echoes a tool result back
    Given the script's tool calls have been answered with tool results
    When the script has a "/next" step left
    Then the answer makes that step's tool calls
    And when no step is left the answer echoes the last tool results, in both dialects

  Scenario: Langy mode refuses a tool the request does not offer
    When a "/tool" line names a tool the request does not offer
    Then the answer is plain text naming the tool and the offered ones, with no tool call

  Scenario: The console lists recent calls and applies its settings
    When a client makes a chat completion
    Then the console's calls list shows it with its model, mode and tokens, and its detail shows the request and reply
    And a forced error set in the console answers every later call with that status

  @integration
  Scenario: The console clears and filters recent calls
    Given the console lists recent calls
    When the operator types a model name into the filter
    Then only calls whose model, path, mode, dialect or status match stay listed
    And confirming "Clear calls" deletes every recorded call and empties the list

  @integration
  Scenario: The console sets any 4xx or 5xx forced error and explains per-call overrides
    When the operator opens the settings tab
    Then the forced error offers 400, 401, 403, 404, 429, 500, 502, 503 and 529
    And a panel names the X-Llmsim-Seed, X-Llmsim-Mode and X-Llmsim-Error headers, the "error-<status>" model name and the "langy-echo" model

  @unit
  Scenario: haven sim llm list filters by model and failure
    Given llmsim has answered calls to two models, one of them failing
    When an agent runs "haven sim llm list --model <name>" or "haven sim llm list --failed"
    Then only the matching calls are listed, with their dialect and mode, in text and in --json
    And "haven sim llm status" prints how many calls the sim keeps

  Scenario: haven +llm points the OpenAI and Anthropic providers at llmsim
    Given a worktree that has never been up
    Then llm is off in its selection
    When the developer runs "haven up +llm"
    Then an llm lane runs llmsim on a port haven allocated
    And the overlay sets OPENAI_BASE_URL and ANTHROPIC_BASE_URL to it, with a dummy key where none is set

  Scenario: The seed writes the llmsim base URLs into the seeded providers
    Given a stack that runs the llm lane
    When haven runs the storage seed for it
    Then the seed's environment carries OPENAI_BASE_URL and ANTHROPIC_BASE_URL pointing at llmsim
    So that the seeded OpenAI and Anthropic provider rows reach llmsim, not the vendor

  @unit
  Scenario: The seeded OpenAI provider offers llmsim's error models
    Given haven routes the OpenAI provider at llmsim
    When the storage seed creates the OpenAI provider row
    Then its custom models are "error-429" and "error-500", so a member can pick a model that fails
    And without haven's llmsim marker the row gets no custom models

  Scenario: A developer's own provider base URL wins over llmsim
    Given .env names OPENAI_BASE_URL
    When the developer runs "haven up +llm"
    Then the overlay leaves the OpenAI provider alone and still routes Anthropic to llmsim

  @unit
  Scenario: The llmsim model provider is hidden when haven does not enable it
    Given the stack runs without "+llm"
    Then no llmsim provider is listed or seeded

  @unit
  Scenario: The llmsim model provider is listed and seeded when haven enables it
    Given the stack runs with "+llm"
    Then llmsim's model list names markov-small, markov-json and langy-echo
    And the api lane's environment points the seeded OpenAI provider at llmsim's URL with a dummy key

  @unimplemented
  Scenario: A playground call answers from llmsim
    Given the stack runs with "+llm"
    When the developer sends a playground message with an llmsim model
    Then the answer streams back from llmsim and the call costs nothing
