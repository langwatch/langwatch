import re
import json
from typing import Dict, Any, List

class MissingPromptVariableError(Exception):
    def __init__(self, missing_vars: List[str]):
        super().__init__(f"Missing variables for prompt: {', '.join(missing_vars)}")
        self.missing_vars = missing_vars

class PromptFormatter:
    """Formats prompt templates with provided variables using {{ var }} syntax."""
    def format(self, template: str, variables: Dict[str, Any]) -> str:
        # First check for any missing variables
        missing_vars = []
        for match in re.finditer(r'{{\s*(\w+)\s*}}', template):
            var_name = match.group(1)
            if var_name not in variables:
                missing_vars.append(var_name)

        if missing_vars:
            raise MissingPromptVariableError(missing_vars)

        # Replace all variables with their values
        result = template
        for var, value in variables.items():
            # Replace {{ var }} with the value
            result = re.sub(r'{{\s*' + re.escape(var) + r'\s*}}', str(value), result)

        return result
