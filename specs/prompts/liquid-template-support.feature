Feature: Full Liquid template support
  As a developer building prompts
  I want to use full Liquid template syntax (if, for, assign, filters) in my prompts
  So that I can create dynamic, conditional prompt templates without custom code

  # ============================================================================
  # TypeScript SDK - compile() with Liquid constructs
  # ============================================================================

  @unit
  Scenario: TypeScript SDK renders if/else conditions
    Given a prompt with template "{% if tone == 'formal' %}Dear user{% else %}Hey{% endif %}, welcome!"
    When I compile with variables {"tone": "formal"}
    Then the compiled output is "Dear user, welcome!"

  @unit
  Scenario: TypeScript SDK renders for loops over arrays
    Given a prompt with template "Topics: {% for item in topics %}{{ item }}{% unless forloop.last %}, {% endunless %}{% endfor %}"
    When I compile with variables {"topics": ["AI", "ML", "NLP"]}
    Then the compiled output is "Topics: AI, ML, NLP"

  @unit
  Scenario: TypeScript SDK renders assign tags
    Given a prompt with template "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}!"
    When I compile with variables {"name": "Alice"}
    Then the compiled output is "Hello, Alice!"

  @unit
  Scenario: TypeScript SDK renders filters
    # LiquidJS truncate: N means N chars of content, then appends "..." (total = N + 3)
    Given a prompt with template "{{ name | upcase }} - {{ description | truncate: 22 }}"
    When I compile with variables {"name": "alice", "description": "This is a very long description text"}
    Then the compiled output is "ALICE - This is a very long..."

  @unit
  Scenario: TypeScript SDK renders nested conditions and loops
    Given a prompt with template "{% for user in users %}{% if user.active %}{{ user.name }}{% endif %}{% endfor %}"
    When I compile with variables {"users": [{"name": "Alice", "active": true}, {"name": "Bob", "active": false}, {"name": "Carol", "active": true}]}
    Then the compiled output is "AliceCarol"

  @unit
  Scenario: TypeScript SDK compileStrict rejects undefined variables in Liquid tags
    Given a prompt with template "{% if mood == 'happy' %}Great!{% endif %}"
    When I compileStrict with empty variables
    Then a PromptCompilationError is thrown

  @unit
  Scenario: TypeScript SDK compile tolerates undefined variables in Liquid tags
    Given a prompt with template "{% if mood == 'happy' %}Great!{% endif %} Hello"
    When I compile with empty variables
    Then the compiled output is " Hello"

  # ============================================================================
  # Python SDK - compile() with Liquid constructs
  # ============================================================================

  @unit
  Scenario: Python SDK renders if/else conditions
    Given a Python prompt with template "{% if tone == 'formal' %}Dear user{% else %}Hey{% endif %}, welcome!"
    When I compile with variables {"tone": "formal"}
    Then the compiled output is "Dear user, welcome!"

  @unit
  Scenario: Python SDK renders for loops over arrays
    Given a Python prompt with template "Topics: {% for item in topics %}{{ item }}{% unless forloop.last %}, {% endunless %}{% endfor %}"
    When I compile with variables {"topics": ["AI", "ML", "NLP"]}
    Then the compiled output is "Topics: AI, ML, NLP"

  @unit
  Scenario: Python SDK renders assign tags
    Given a Python prompt with template "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}!"
    When I compile with variables {"name": "Alice"}
    Then the compiled output is "Hello, Alice!"

  @unit
  Scenario: Python SDK renders filters
    # python-liquid truncate: N means N total chars including the "..." suffix
    Given a Python prompt with template "{{ name | upcase }} - {{ description | truncate: 20 }}"
    When I compile with variables {"name": "alice", "description": "This is a very long description text"}
    Then the compiled output is "ALICE - This is a very lo..."

  @unit
  Scenario: Python SDK compileStrict rejects undefined variables in Liquid tags
    Given a Python prompt with template "{% if mood == 'happy' %}Great!{% endif %}"
    When I compile_strict with empty variables
    Then a PromptCompilationError is raised

  @unit
  Scenario: Python SDK compile tolerates undefined variables in Liquid tags
    Given a Python prompt with template "{% if mood == 'happy' %}Great!{% endif %} Hello"
    When I compile with empty variables
    Then the compiled output is " Hello"

  # ============================================================================
  # SDK parity - both SDKs produce identical output for the same template
  # Note: Parity is verified via golden-file comparison - each SDK outputs to
  # a fixture file and a comparison step validates identical results.
  # ============================================================================

  @integration
  Scenario: TypeScript and Python SDKs produce identical output for conditional templates
    Given both SDKs have a prompt with template "{% if lang == 'en' %}Hello{% elsif lang == 'es' %}Hola{% else %}Hi{% endif %}"
    When both compile with variables {"lang": "es"}
    Then both produce "Hola"

  @integration
  Scenario: TypeScript and Python SDKs produce identical output for loop templates
    Given both SDKs have a prompt with template "{% for tag in tags %}#{{ tag }} {% endfor %}"
    When both compile with variables {"tags": ["ai", "ml"]}
    Then both produce "#ai #ml "

  # ============================================================================
  # Platform execution - scenario adapters with Liquid constructs
  # ============================================================================

  @unit
  Scenario: Prompt config adapter renders Liquid conditions in system prompt
    Given a prompt config with system prompt "{% if input contains 'refund' %}You handle refunds.{% else %}You are a general assistant.{% endif %}"
    When the adapter receives input "I need a refund"
    Then the system prompt resolves to "You handle refunds."

  @unit
  Scenario: Prompt config adapter renders Liquid loops in messages
    Given a prompt config with a message template "Summary: {% for msg in messages %}[{{ msg }}]{% endfor %}"
    When the adapter receives messages ["Hello", "How are you?"]
    Then the message content is "Summary: [Hello][How are you?]"

  @unit
  Scenario: HTTP agent adapter renders Liquid conditions in body template
    Given an HTTP agent with body template '{"mode": "{% if input contains 'search' %}search{% else %}chat{% endif %}", "query": "{{ input }}"}'
    When the adapter receives input "search for cats"
    Then the request body contains mode "search"

  # ============================================================================
  # Platform execution - DSPy template adapter with Liquid constructs
  # ============================================================================

  @unit
  Scenario: DSPy template adapter renders Liquid conditions in message templates
    Given a DSPy signature with message template "{% if context %}Use this context: {{ context }}{% endif %}Question: {{ question }}"
    And inputs {"question": "What is AI?", "context": "AI is artificial intelligence"}
    When the adapter formats the messages
    Then the rendered message includes "Use this context: AI is artificial intelligence"
    And the rendered message includes "Question: What is AI?"

  @unit
  Scenario: DSPy template adapter renders Liquid conditions with missing optional input
    Given a DSPy signature with message template "{% if context %}Use this context: {{ context }}{% endif %}Question: {{ question }}"
    And inputs {"question": "What is AI?"}
    When the adapter formats the messages
    Then the rendered message does not include "Use this context"
    And the rendered message includes "Question: What is AI?"

  # ============================================================================
  # Syntax highlighting - Liquid template tokenizer
  # ============================================================================

  @unit
  Scenario: Tokenizer identifies if/endif tags
    Given the text "{% if tone == 'formal' %}Dear user{% endif %}"
    When the text is tokenized
    Then token 0 is a liquid-tag "{% if tone == 'formal' %}"
    And token 1 is plain-text "Dear user"
    And token 2 is a liquid-tag "{% endif %}"

  @unit
  Scenario: Tokenizer identifies for/endfor tags and variable expressions
    Given the text "{% for item in items %}{{ item }}{% endfor %}"
    When the text is tokenized
    Then token 0 is a liquid-tag "{% for item in items %}"
    And token 1 is a variable "{{ item }}"
    And token 2 is a liquid-tag "{% endfor %}"

  @unit
  Scenario: Tokenizer identifies assign tags
    Given the text "{% assign greeting = 'Hello' %}{{ greeting }}"
    When the text is tokenized
    Then token 0 is a liquid-tag "{% assign greeting = 'Hello' %}"
    And token 1 is a variable "{{ greeting }}"

  @unit
  Scenario: Tokenizer identifies filters in variable expressions
    Given the text "{{ name | upcase }}"
    When the text is tokenized
    Then token 0 is a variable "{{ name | upcase }}"

  @unit
  Scenario: Tokenizer identifies elsif and else tags
    Given the text "{% if x %}A{% elsif y %}B{% else %}C{% endif %}"
    When the text is tokenized
    Then token 0 is a liquid-tag "{% if x %}"
    And token 1 is plain-text "A"
    And token 2 is a liquid-tag "{% elsif y %}"
    And token 3 is plain-text "B"
    And token 4 is a liquid-tag "{% else %}"
    And token 5 is plain-text "C"
    And token 6 is a liquid-tag "{% endif %}"

  @unit
  Scenario: Tokenizer handles mixed content correctly
    Given the text "Hello {% if formal %}Sir{% endif %}, {{ name | capitalize }}"
    When the text is tokenized
    Then token 0 is plain-text "Hello "
    And token 1 is a liquid-tag "{% if formal %}"
    And token 2 is plain-text "Sir"
    And token 3 is a liquid-tag "{% endif %}"
    And token 4 is plain-text ", "
    And token 5 is a variable "{{ name | capitalize }}"

  @unit
  Scenario: Tokenizer treats unclosed tags as plain text
    Given the text "{% if x"
    When the text is tokenized
    Then token 0 is plain-text "{% if x"

  # ============================================================================
  # Variable extraction - Liquid-aware parsing
  # ============================================================================

  @unit
  Scenario: Variable extraction finds variables inside Liquid tags
    Given the text "{% if tone %}{{ name }}{% endif %}"
    When variables are extracted
    Then "tone" is included as a used variable
    And "name" is included as a used variable

  @unit
  Scenario: Variable extraction ignores Liquid keywords
    Given the text "{% for item in items %}{{ item }}{% endfor %}"
    When variables are extracted
    Then "items" is included as a used variable
    And "item" is included as a loop variable (not a template input)
    And Liquid keywords like "for", "in", "endfor" are not extracted as variables

  @unit
  Scenario: Variable extraction handles filters without treating filter names as variables
    Given the text "{{ name | upcase | truncate: 20 }}"
    When variables are extracted
    Then "name" is included as a used variable
    And "upcase" is not included as a variable
    And "truncate" is not included as a variable

  @unit
  Scenario: Variable extraction handles assign without treating assigned name as input variable
    Given the text "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}"
    When variables are extracted
    Then "name" is included as a used variable
    And "greeting" is recognized as locally assigned, not an input variable

  @unit
  Scenario: Variable extraction handles nested Liquid structures
    Given the text "{% for item in items %}{% if item.active %}{{ item.name }}{% endif %}{% endfor %}"
    When variables are extracted
    Then "items" is included as a used variable
    And "item" is included as a loop variable (not a template input)
