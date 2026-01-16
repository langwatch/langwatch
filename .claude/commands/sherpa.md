# Sherpa - LangWatch Development Guide

Use the Task tool to invoke the sherpa agent with the user's request.

The sherpa agent:
- Knows LangWatch product context, personas, and patterns
- Guides features from ideation through testing using BDD workflow
- Routes to specialized agents (playwright-test-planner, playwright-test-generator, playwright-test-healer)
- Ensures quality through proper specs and test coverage

Pass along the full user request: $ARGUMENTS
