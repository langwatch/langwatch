from typing import List, Any, Dict, Union, Optional, cast
from openai.types.chat import ChatCompletionMessageParam
from liquid import Environment, StrictUndefined, Undefined
from liquid.exceptions import UndefinedError
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from .formatter import PromptFormatter
from .decorators.prompt_tracing import prompt_tracing
from .types import MessageDict


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

    def __init__(
        self,
        config: GetApiPromptsByIdResponse200,
        formatter: PromptFormatter = PromptFormatter(),
    ):
        self._config = config
        self._formatter = formatter

    def __getattr__(self, name: str) -> Any:
        """Delegate attribute access to the underlying config object"""
        if hasattr(self._config, name):
            return getattr(self._config, name)
        raise AttributeError(
            f"'{self.__class__.__name__}' object has no attribute '{name}'"
        )

    @property
    def raw(self) -> Any:
        """Get the raw prompt data from the API"""
        return self._config

    @property
    def version_number(self) -> int:
        """Returns the version number of the prompt."""
        return int(self._config.version)

    def _compile(self, variables: TemplateVariables, strict: bool) -> "CompiledPrompt":
        """
        Internal method to compile the prompt template with provided variables.
        """
        try:
            # Create environment based on strict mode
            env = Environment(undefined=StrictUndefined if strict else Undefined)

            # Compile main prompt
            compiled_prompt = ""
            if self._config.prompt:
                template = env.from_string(self._config.prompt)
                compiled_prompt = template.render(**variables)

            # Compile messages
            compiled_messages: List[MessageDict] = []
            if self._config.messages:
                for message in self._config.messages:
                    content: str = message.content
                    template = env.from_string(content)
                    compiled_content = template.render(**variables)
                    compiled_message = MessageDict(
                        role=message.role.value,
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
            template_str = self._config.prompt or str(self._config.messages or [])
            raise PromptCompilationError(
                f"Failed to compile prompt template: {str(error)}", template_str, error
            )
        except Exception as error:
            template_str = self._config.prompt or str(self._config.messages or [])
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

        # Expose original prompt properties for convenience
        self.id = original_prompt.id
        self.version = original_prompt.version
        self.version_id = original_prompt.version_id
        # ... other properties as needed

    @property
    def messages(self) -> List[ChatCompletionMessageParam]:
        """
        Returns the compiled messages as a list of ChatCompletionMessageParam objects.
        This is a convenience method to make the messages accessible as a list of
        ChatCompletionMessageParam objects, which is the format expected by the OpenAI API.
        """
        messages = [
            cast(ChatCompletionMessageParam, msg) for msg in self._compiled_messages
        ]

        return messages

    def __getattr__(self, name: str) -> Any:
        """Delegate unknown attributes to original prompt for backward compatibility"""
        return getattr(self.original, name)
