from typing import List, Any, Dict, Union, Optional, cast, TYPE_CHECKING

if TYPE_CHECKING:
    from openai.types.chat import ChatCompletionMessageParam

from liquid import Environment, StrictUndefined, Undefined
from liquid.exceptions import UndefinedError
from .decorators.prompt_tracing import prompt_tracing
from .types import PromptData, MessageDict


class PromptCompilationError(Exception):
    """Error class for template compilation issues"""

    def __init__(
        self, message: str, template: str, original_error: Optional[Exception] = None
    ):
        super().__init__(message)
        self.template = template
        self.original_error = original_error
        self.name = "PromptCompilationError"


# Type for template variables - supporting common data types
TemplateVariables = Dict[
    str, Union[str, int, float, bool, Dict[str, Any], List[Any], None]
]


class Prompt:
    """
    A class representing a prompt configuration that can be used with OpenAI's API.
    Handles formatting messages with variables using Liquid templating.
    """

    def __init__(self, data: PromptData):
        # Store raw data for backward compatibility
        self._data = data.copy()

        # Assign all fields directly as instance attributes
        for key, value in data.items():
            setattr(self, key, value)

        # Set prompt default only if not provided (like TypeScript)
        if not hasattr(self, "prompt") or self.prompt is None:
            self.prompt = self._extract_system_prompt()

    @property
    def raw(self) -> PromptData:
        """Get the raw prompt data"""
        return self._data

    def _extract_system_prompt(self) -> str:
        """Extract system prompt from messages, like TypeScript version."""
        if hasattr(self, "messages") and self.messages:
            for message in self.messages:
                if message.get("role") == "system":
                    return message.get("content", "")
        return ""

    def _compile(self, variables: TemplateVariables, strict: bool) -> "CompiledPrompt":
        """
        Internal method to compile the prompt template with provided variables.
        """
        try:
            # Create environment based on strict mode
            env = Environment(undefined=StrictUndefined if strict else Undefined)

            # Compile main prompt
            compiled_prompt = ""
            if hasattr(self, "prompt") and self.prompt:
                template = env.from_string(self.prompt)
                compiled_prompt = template.render(**variables)

            # Compile messages
            compiled_messages: List[MessageDict] = []
            if hasattr(self, "messages") and self.messages:
                for message in self.messages:
                    content: str = message["content"]
                    template = env.from_string(content)
                    compiled_content = template.render(**variables)
                    compiled_message = MessageDict(
                        role=message["role"],
                        content=compiled_content,
                    )
                    compiled_messages.append(compiled_message)

            # Return simplified CompiledPrompt with variables preserved
            return CompiledPrompt(
                original_prompt=self,
                compiled_prompt=compiled_prompt,
                compiled_messages=compiled_messages,
                variables=variables.copy(),  # Store a copy of the variables
            )

        except UndefinedError as error:
            template_str = getattr(self, "prompt", "") or str(
                getattr(self, "messages", [])
            )
            raise PromptCompilationError(
                f"Failed to compile prompt template: {str(error)}", template_str, error
            )
        except Exception as error:
            template_str = getattr(self, "prompt", "") or str(
                getattr(self, "messages", [])
            )
            raise PromptCompilationError(
                f"Failed to compile prompt template: {str(error)}", template_str, error
            )

    @prompt_tracing.compile
    def compile(
        self, variables: Optional[TemplateVariables] = None, **kwargs: Any
    ) -> "CompiledPrompt":
        """
        Compile the prompt template with provided variables (lenient - missing variables become empty).

        Args:
            variables: Dictionary containing variable values for template compilation
            **kwargs: Alternative way to pass variables as keyword arguments

        Returns:
            CompiledPrompt instance with compiled content
        """
        if variables is None:
            variables = {}

        # Merge explicit dict with kwargs, kwargs take precedence for conflicts
        merged_variables = {**variables, **kwargs}
        return self._compile(merged_variables, strict=False)

    @prompt_tracing.compile_strict
    def compile_strict(
        self, variables: Optional[TemplateVariables] = None, **kwargs: Any
    ) -> "CompiledPrompt":
        """
        Compile with validation - throws error if required variables are missing.

        Args:
            variables: Template variables

        Returns:
            CompiledPrompt instance with compiled content

        Raises:
            PromptCompilationError: If required variables are missing or compilation fails
        """
        if variables is None:
            variables = {}

        # Merge explicit dict with kwargs, kwargs take precedence for conflicts
        merged_variables = {**variables, **kwargs}
        return self._compile(merged_variables, strict=True)


class CompiledPrompt:
    """
    Represents a compiled prompt with compiled content and original variables
    """

    def __init__(
        self,
        original_prompt: "Prompt",
        compiled_prompt: str,
        compiled_messages: List[MessageDict],
        variables: TemplateVariables,
    ):
        self.original = original_prompt
        self.prompt = compiled_prompt
        self.variables = variables  # Store the original compilation variables
        self._compiled_messages = compiled_messages

        # Properties are delegated via __getattr__ below

    @property
    def messages(self) -> List["ChatCompletionMessageParam"]:
        """
        Returns the compiled messages as a list of ChatCompletionMessageParam objects.
        This is a convenience method to make the messages accessible as a list of
        ChatCompletionMessageParam objects, which is the format expected by the OpenAI API.
        """
        messages = [
            cast("ChatCompletionMessageParam", msg) for msg in self._compiled_messages
        ]

        return messages

    def __getattr__(self, name: str) -> Any:
        """Delegate unknown attributes to original prompt for backward compatibility"""
        return getattr(self.original, name)
