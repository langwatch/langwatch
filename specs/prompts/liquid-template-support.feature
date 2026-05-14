Feature: Full Liquid template support
  As a developer building prompts
  I want to use full Liquid template syntax (if, for, assign, filters) in my prompts
  So that I can create dynamic, conditional prompt templates without custom code

  # Both remaining @unimplemented scenarios are KEEP class per AUDIT_MANIFEST.md:
  # they assert TS/Python SDK Liquid output parity (cross-SDK golden-file test).
  # Each SDK has unit coverage independently (typescript-sdk liquid-template-support.unit.test.ts;
  # python-sdk tests/prompts/test_liquid_template_support.py) but no harness
  # exists to run both SDKs against the same template and compare output bytes.
  # Aspirational pending cross-language test harness.

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
