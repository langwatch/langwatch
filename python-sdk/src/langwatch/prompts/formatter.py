import re
from typing import Dict, Any, List

class MissingPromptVariableError(Exception):
    def __init__(self, missing_vars: List[str]):
        super().__init__(f"Missing variables for prompt: {', '.join(missing_vars)}")
        self.missing_vars = missing_vars

class PromptFormatter:
    """Formats prompt templates with provided variables."""
    def format(self, template: str, variables: Dict[str, Any]) -> str:
        # Find all variables in the format {{ variable }}
        required_vars = set(re.findall(r"\{\{(\w+)\}\}", template))
        missing = required_vars - variables.keys()
        if missing:
            raise MissingPromptVariableError(list(missing))
        
        # Replace {{ variable }} with {variable} for format()
        formatted_template = re.sub(r"\{\{\s*(\w+)\s*\}\}", r"{\1}", template)
        return formatted_template.format(**variables)