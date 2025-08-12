import warnings
from typing import List, Any, Dict, Union, Optional, cast
from openai.types.chat import ChatCompletionMessageParam
from liquid import Environment, StrictUndefined, Undefined
from liquid.exceptions import UndefinedError
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from .formatter import PromptFormatter
from .decorators.prompt_tracing import prompt_tracing


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

    def _extract_message_info(
        self, message: Union[Dict[str, Any], Any]
    ) -> tuple[str, str]:
        """
        Extract role and content from a message, handling both dict and object formats.

        Args:
            message: Message object or dictionary

        Returns:
            Tuple of (role_str, content_str)
        """
        if isinstance(message, dict):
            # Dictionary format (from tests/fixtures)
            role = message["role"]
            content = message["content"]
            role_str = role.value if hasattr(role, "value") else str(role)
            content_str = str(content)
        else:
            # Object format (from API responses)
            role_str = message.role.value
            content_str = message.content

        return role_str, content_str

    def _compile(self, variables: TemplateVariables, strict: bool) -> "CompiledPrompt":
        """
        Internal method to compile the prompt template with provided variables.

        Args:
            variables: Dictionary of variables for template compilation
            strict: Whether to enforce strict variable checking

        Returns:
            CompiledPrompt instance with compiled content

        Raises:
            PromptCompilationError: If template compilation fails
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
            compiled_messages: List[Dict[str, str]] = []
            if self._config.messages:
                for message in self._config.messages:
                    role_str, content_str = self._extract_message_info(message)

                    if content_str:
                        template = env.from_string(content_str)
                        compiled_content = template.render(**variables)
                        compiled_message = {
                            "role": role_str,
                            "content": compiled_content,
                        }
                    else:
                        # Keep message as-is if no content to compile
                        compiled_message = {
                            "role": role_str,
                            "content": content_str,
                        }
                    compiled_messages.append(compiled_message)

            # Create a mock config object with compiled content
            class CompiledConfig:
                def __init__(
                    self,
                    original_config: Any,
                    compiled_prompt: str,
                    compiled_messages: List[Dict[str, str]],
                ):
                    # Copy all original attributes
                    for attr in dir(original_config):
                        if not attr.startswith("_"):
                            try:
                                setattr(self, attr, getattr(original_config, attr))
                            except AttributeError:
                                # Skip attributes that can't be set
                                pass

                    # Override with compiled content
                    self.prompt = compiled_prompt
                    self.messages = compiled_messages

            compiled_config = CompiledConfig(
                self._config, compiled_prompt, compiled_messages
            )
            return CompiledPrompt(compiled_config, self)

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

    def format_messages(self, **variables: Any) -> List[ChatCompletionMessageParam]:
        """
        Formats the prompt messages with the provided variables.

        **DEPRECATED**: This method is deprecated and will be removed in a future version.
        Please use the `compile()` method instead.

        Args:
            **variables: Variables to format the prompt messages with

        Returns:
            List of formatted messages compatible with ChatCompletionMessageParam

        Raises:
            MissingPromptVariableError: If required variables are missing
        """
        warnings.warn(
            "The 'format_messages' method is deprecated and will be removed in a future version. "
            "Please use the 'compile()' method instead.",
            DeprecationWarning,
            stacklevel=2,
        )

        compiled_messages = self.compile(variables)

        formatted_messages = [
            {
                "role": msg["role"],
                "content": msg["content"],
            }
            for msg in compiled_messages.messages
        ]

        # Cast to ChatCompletionMessageParam for type compatibility
        return cast(List[ChatCompletionMessageParam], formatted_messages)

    def raw_config(self) -> Any:
        """Returns the raw prompt configuration (legacy method)."""
        return self._config


class CompiledPrompt(Prompt):
    """
    Represents a compiled prompt that extends Prompt with reference to the original template
    """

    def __init__(self, compiled_config: Any, original: Prompt):
        super().__init__(compiled_config)
        self.original = original
