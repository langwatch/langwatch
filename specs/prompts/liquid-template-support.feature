Feature: Full Liquid template support
  As a developer building prompts
  I want to use full Liquid template syntax (if, for, assign, filters) in my prompts
  So that I can create dynamic, conditional prompt templates without custom code

  # ============================================================================
  # TypeScript SDK - compile() with Liquid constructs
  # ============================================================================

  @integration @unimplemented
  Scenario: TypeScript and Python SDKs produce identical output for conditional templates
    Given both SDKs have a prompt with template "{% if lang == 'en' %}Hello{% elsif lang == 'es' %}Hola{% else %}Hi{% endif %}"
    When both compile with variables {"lang": "es"}
    Then both produce "Hola"

  @integration @unimplemented
  Scenario: TypeScript and Python SDKs produce identical output for loop templates
    Given both SDKs have a prompt with template "{% for tag in tags %}#{{ tag }} {% endfor %}"
    When both compile with variables {"tags": ["ai", "ml"]}
    Then both produce "#ai #ml "

  # ============================================================================
  # Platform execution - scenario adapters with Liquid constructs
  # ============================================================================
