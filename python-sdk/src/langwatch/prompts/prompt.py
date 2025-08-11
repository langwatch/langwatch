import warnings
from typing import List, Any, Dict, Union, Optional
from openai.types.chat import ChatCompletionMessageParam
from opentelemetry import trace
from functools import wraps
from liquid import Template
from liquid.exceptions import LiquidSyntaxError, UndefinedError
from langwatch.generated.langwatch_rest_api_client.models.get_api_prompts_by_id_response_200 import (
    GetApiPromptsByIdResponse200,
)
from .formatter import PromptFormatter, MissingPromptVariableError


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
TemplateVariables = Dict[str, Union[str, int, float, bool, dict, list, None]]


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

        Args:
            variables: Dictionary of variables for template compilation
            strict: Whether to enforce strict variable checking

        Returns:
            CompiledPrompt instance with compiled content

        Raises:
            PromptCompilationError: If template compilation fails
        """
        try:
            # Compile main prompt
            compiled_prompt = ""
            if hasattr(self._config, "prompt") and self._config.prompt:
                template = Template(self._config.prompt)
                if strict:
                    # In strict mode, check for undefined variables first
                    compiled_prompt = template.render(
                        **variables, strict_variables=True
                    )
                else:
                    # In lenient mode, undefined variables become empty strings
                    compiled_prompt = template.render(
                        **variables, strict_variables=False
                    )

            # Compile messages
            compiled_messages = []
            if hasattr(self._config, "messages"):
                for message in self._config.messages:
                    if hasattr(message, "content") and message.content:
                        template = Template(message.content)
                        if strict:
                            compiled_content = template.render(
                                **variables, strict_variables=True
                            )
                        else:
                            compiled_content = template.render(
                                **variables, strict_variables=False
                            )

                        # Create a new message dict with compiled content
                        compiled_message = {
                            "role": (
                                message.role.value
                                if hasattr(message.role, "value")
                                else message.role
                            ),
                            "content": compiled_content,
                        }
                        compiled_messages.append(compiled_message)
                    else:
                        # Keep message as-is if no content to compile
                        compiled_message = {
                            "role": (
                                message.role.value
                                if hasattr(message.role, "value")
                                else message.role
                            ),
                            "content": getattr(message, "content", ""),
                        }
                        compiled_messages.append(compiled_message)

            # Create a mock config object with compiled content
            class CompiledConfig:
                def __init__(self, original_config, compiled_prompt, compiled_messages):
                    # Copy all original attributes
                    for attr in dir(original_config):
                        if not attr.startswith("_"):
                            try:
                                setattr(self, attr, getattr(original_config, attr))
                            except AttributeError:
                                # Skip attributes that can't be set
                                pass

                    # Override with compiled content
                    if hasattr(original_config, "prompt"):
                        self.prompt = compiled_prompt
                    if hasattr(original_config, "messages"):
                        self.messages = compiled_messages

            compiled_config = CompiledConfig(
                self._config, compiled_prompt, compiled_messages
            )
            return CompiledPrompt(compiled_config, self)

        except (LiquidSyntaxError, UndefinedError) as error:
            template_str = getattr(self._config, "prompt", "") or str(
                getattr(self._config, "messages", [])
            )
            raise PromptCompilationError(
                f"Failed to compile prompt template: {str(error)}", template_str, error
            )
        except Exception as error:
            template_str = getattr(self._config, "prompt", "") or str(
                getattr(self._config, "messages", [])
            )
            raise PromptCompilationError(
                f"Failed to compile prompt template: {str(error)}", template_str, error
            )

    @_compile_tracing
    def compile(
        self, variables: Optional[TemplateVariables] = None
    ) -> "CompiledPrompt":
        """
        Compile the prompt template with provided variables (lenient - missing variables become empty).

        Args:
            variables: Dictionary containing variable values for template compilation

        Returns:
            CompiledPrompt instance with compiled content
        """
        if variables is None:
            variables = {}
        return self._compile(variables, strict=False)

    @_compile_tracing
    def compile_strict(self, variables: TemplateVariables) -> "CompiledPrompt":
        """
        Compile with validation - throws error if required variables are missing.

        Args:
            variables: Template variables

        Returns:
            CompiledPrompt instance with compiled content

        Raises:
            PromptCompilationError: If required variables are missing or compilation fails
        """
        return self._compile(variables, strict=True)

    def format_messages(self, **variables: Any) -> List[ChatCompletionMessageParam]:
        """
        Formats the prompt messages with the provided variables.

        **DEPRECATED**: This method is deprecated and will be removed in a future version.
        Please use the `compile()` method instead.

        Args:
            **variables: Variables to format the prompt messages with

        Returns:
            List[Dict[str, str]]: List of formatted messages

        Raises:
            MissingPromptVariableError: If required variables are missing
        """
        warnings.warn(
            "The 'format_messages' method is deprecated and will be removed in a future version. "
            "Please use the 'compile()' method instead.",
            DeprecationWarning,
            stacklevel=2,
        )

        return [
            {
                "role": msg.role.value,
                "content": self._formatter.format(msg.content, variables),
            }
            for msg in self._config.messages
        ]

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
