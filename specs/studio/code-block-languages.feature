Feature: Studio code blocks in JavaScript and Python
  As a Studio user building workflows,
  I want new code nodes to start in JavaScript with a typed editor
  so that I get accurate completion and errors, while my existing Python nodes keep working.

  # The editor checks JavaScript against exactly what the engine's QuickJS runtime
  # provides (services/nlpgo/app/engine/blocks/codeblock/runner.mjs). Secret names are
  # offered for completion; secret values never reach the browser.

  Background:
    Given the user has a workflow open in Studio

  # Language of a code node

  @unit
  Scenario: A new code node is JavaScript
    When the user adds a code node
    Then its language parameter is "javascript"

  @unit
  Scenario: The JavaScript template destructures the input and returns the output
    When the user adds a code node
    Then the code is a default export that destructures the input
    And it returns an object keyed by the output

  @unit
  Scenario: The JavaScript template is typed through JSDoc
    When the user adds a code node
    Then the entrypoint is annotated with the editor's Inputs and Outputs types

  @unit
  Scenario: The JavaScript template contains no Python
    When the user adds a code node
    Then the code has no class, no __call__ and no dspy reference

  @unit
  Scenario: The JavaScript template type-checks against the runtime
    When the user adds a code node and keeps the default fields
    Then the editor reports no diagnostics

  @unit
  Scenario: A node saved before JavaScript existed reads as Python
    Given a code node with no language parameter
    Then its language is Python

  @unit
  Scenario: A language parameter of javascript reads as JavaScript
    Given a code node whose language parameter is "javascript"
    Then its language is JavaScript

  @unit
  Scenario: An unrecognised language reads as Python
    Given a code node whose language parameter is anything other than "javascript"
    Then its language is Python

  @integration
  Scenario: A JavaScript node opens in the JavaScript editor
    When the user opens a code node whose language is "javascript"
    Then the properties panel passes "javascript" to the code editor

  @integration
  Scenario: A node without a language opens in the Python editor with no migration
    When the user opens a code node that has no language parameter
    Then the properties panel passes "python" to the code editor
    And the node's code and parameters are not rewritten

  # Editor presentation per language

  @unit
  Scenario: JavaScript is edited as code.mjs with two-space tabs
    Given a JavaScript code node
    Then the editor uses Monaco's javascript mode
    And the file is named "code.mjs", labelled "JavaScript", with a tab size of 2

  @unit
  Scenario: A node without a language is edited as Python
    Given a code node without a language
    Then the editor uses Monaco's python mode
    And the file is named "Code.py", labelled "Python", with a tab size of 4

  @integration
  Scenario: The JavaScript editor registers the JavaScript service and no Python providers
    When the user opens the editor for a JavaScript node
    Then the status bar shows "code.mjs", "JavaScript" and "Spaces: 2"
    And the JavaScript language service is registered with the project's secret names
    And no Python completion, hover or validation provider is registered

  @integration
  Scenario: The Python editor registers the Python providers and no JavaScript service
    When the user opens the editor for a node without a language
    Then the status bar shows "Code.py" and "Python"
    And the Python providers are registered
    And the JavaScript language service is not registered

  # What the JavaScript editor offers and checks

  @unit
  Scenario: JavaScript is checked as ES2023 without DOM
    When a JavaScript editor opens
    Then the compiler checks ES2023 with only the es2023 lib
    And semantic and syntax diagnostics are on

  @unit
  Scenario: Runtime globals type-check
    Given a JavaScript block using fetch, console, timers, btoa, secrets and params
    Then the editor reports no diagnostics

  @unit
  Scenario: DOM globals are flagged
    Given a JavaScript block that reads document or window
    Then the editor flags "Cannot find name 'document'"

  @unit
  Scenario: The declarations hold no DOM globals
    When the runtime declarations are built
    Then they declare no document, window, XMLHttpRequest or localStorage

  @unit
  Scenario: Secret names are offered for completion
    Given the project has a secret named "API_KEY"
    When the user types "secrets." in a JavaScript block
    Then "API_KEY" is offered
    And the editor offers no DOM global at the top level

  @unit
  Scenario: Secrets are declared as documented read-only strings
    Given the project has secrets "API_KEY" and "weird-name"
    When the runtime declarations are built
    Then each secret is a documented readonly string
    And a name that is not an identifier is quoted

  @unit
  Scenario: Secret values never reach the editor
    Given the project has a secret named "TOKEN" with a value
    When the runtime declarations are built from the contract
    Then the declarations contain the name "TOKEN"
    And they do not contain the secret's value

  @unit
  Scenario: An unknown secret is flagged
    Given a JavaScript block reading secrets.MISSING
    Then the editor flags "Property 'MISSING' does not exist"

  @unit
  Scenario: A wrong output type is flagged
    Given the node has a string output "answer"
    And a JavaScript block returns a number for it
    Then the editor flags that the number is not assignable to string

  @unit
  Scenario: The secrets namespace completes when the project has no secrets
    Given the project has no secrets
    When the runtime declarations are built
    Then the secrets namespace is still declared

  @unit
  Scenario: Inputs and Outputs are typed from the node's fields
    Given a node with str, int and list[bool] inputs
    When the runtime declarations are built
    Then Inputs types them as string, number and boolean[]
    And Outputs types the node's outputs

  @unit
  Scenario: Studio field types map to TypeScript
    Then float is number, dict is Record<string, unknown> and image is unknown

  # Isolation between editors

  @unit
  Scenario: The runtime library is added under one uri per editor
    When a JavaScript editor opens
    Then one ambient library with the node's globals is added

  @unit
  Scenario: Two open editors do not share a library
    Given two JavaScript editors are open
    When the first one closes
    Then the second one's library is still present
    And the first one's library is gone

  @unit
  Scenario: A changed contract replaces the library
    Given a JavaScript editor is open
    When the node's secrets change
    Then the library under the same uri is replaced
    And the old secret names are gone

  @unit
  Scenario: Closing the editor removes the library and restores the page's options
    When the JavaScript editor closes
    Then its library is removed
    And the compiler and diagnostics options the page had before are restored

  # Python parameters

  @unit
  Scenario: Python completion offers params
    Given a Python code node
    When the user types "pa" on a fresh line
    Then "params" is offered

  @unit
  Scenario: Python hover explains a run parameter
    Given a Python code node
    When the user hovers params.limit
    Then the hover names "params.limit"
    And it says the value keeps its JSON type

  # Signature and output sync

  @unit
  Scenario: Adding an input rewrites the JavaScript destructured parameter
    Given a JavaScript default export that destructures its inputs
    When an input is added
    Then it is added to the destructured parameter

  @unit
  Scenario: Renaming an input rewrites the JavaScript destructured parameter
    Given a JavaScript default export that destructures its inputs
    When an input is renamed
    Then the old name is replaced by the new one

  @unit
  Scenario: Defaults and a rest element survive an input sync
    Given a destructured parameter with a default value and a rest element
    When the inputs change
    Then surviving entries keep their text
    And the rest element stays last

  @unit
  Scenario: A named execute export is rewritten
    Given a JavaScript block with an exported execute function
    When an input is added
    Then its destructured parameter is rewritten

  @unit
  Scenario: An entrypoint taking the inputs object whole is left alone
    Given a JavaScript entrypoint that takes a single inputs object
    When the inputs change
    Then the code is unchanged

  @unit
  Scenario: Adding an input to a JavaScript node never writes Python
    Given a JavaScript code node
    When an input is added through the store
    Then the destructured parameter gains the input
    And no Python signature or import is written

  @unit
  Scenario: Renaming an output rewrites the returned key
    Given a JavaScript code node returning { output: "Hello" }
    When the output is renamed to "answer"
    Then the code returns { answer: "Hello" }

  @unit
  Scenario: A quoted returned key keeps its quotes when renamed
    Given a JavaScript code node returning { "output": "Hello" }
    When the output is renamed to "answer"
    Then the code returns { "answer": "Hello" }

  @unit
  Scenario: Renaming a JavaScript node leaves the code untouched
    Given a JavaScript code node
    When the node is renamed
    Then the code is returned as the same value, with no class rename

  @unit
  Scenario: A node without a language still gets Python signature sync
    Given a code node with no language and a Python __call__ signature
    When an input is added through the store
    Then the Python signature gains the input with a None default
    And the code gains no destructured parameter
