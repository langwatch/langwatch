# CLI Examples

This directory contains command-line interface examples that demonstrate LangWatch features through CLI workflows rather than interactive chatbot scenarios.

## Examples

- `guaranteed_availability_with_cli.py` - Demonstrates guaranteed availability by using the LangWatch CLI to create and manage prompts locally

## Running CLI Examples

### Individual Example
```bash
python examples/cli/guaranteed_availability_with_cli.py
```

### All CLI Examples
```bash
make cli-examples
```

## Testing

CLI examples are tested separately from bot examples:
- `make bot-examples` - Tests interactive chatbot examples
- `make cli-examples` - Tests CLI workflow examples
- `make test-examples` - Runs both bot and CLI examples

## Requirements

CLI examples may require additional dependencies:
- Node.js/npx for LangWatch CLI commands
- LANGWATCH_API_KEY environment variable
- Various CLI tools depending on the example

See individual example files for specific prerequisites.
