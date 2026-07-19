from typing import List, Any, Dict, Union, Optional, cast, TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, computed_field

if TYPE_CHECKING:
    from openai.types.chat import ChatCompletionMessageParam

from liquid import Environment, StrictUndefined, Undefined
from liquid.exceptions import UndefinedError
from .decorators.prompt_tracing import prompt_tracing
from .types import PromptData, Message


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


class Prompt(PromptData):
    """
    A class representing a prompt configuration that can be used with OpenAI's API.
    Handles formatting messages with variables using Liquid templating.
    """

    _raw_data: Optional[PromptData] = PrivateAttr(default=None)

    def __init__(
        self,
        data: Union["PromptData", Dict[str, Any], None] = None,
        **kwargs: Any,
    ):
        if data is not None:
            if isinstance(data, BaseModel):
                init_kwargs = data.model_dump()
            elif isinstance(data, dict):
                init_kwargs = dict(data)
            else:
                init_kwargs = {}
            init_kwargs.update(kwargs)
            super().__init__(**init_kwargs)
            if isinstance(data, PromptData):
                self._raw_data = data.model_copy()
            else:
                self._raw_data = PromptData(**init_kwargs)
        else:
            super().__init__(**kwargs)
            self._raw_data = PromptData(**kwargs)

        # Set prompt default only if not provided (like TypeScript)
        if self.prompt is None:
            self.prompt = self._extract_system_prompt()

    @property
    def raw(self) -> PromptData:
        """Get the raw prompt data"""
        if self._raw_data is not None:
            return self._raw_data
        return PromptData(**self.model_dump())

    def _extract_system_prompt(self) -> str:
        """Extract system prompt from messages, like TypeScript version."""
        if self.messages:
            for message in self.messages:
                if message.role == "system":
                    return message.content
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
            if self.prompt:
                template = env.from_string(self.prompt)
                compiled_prompt = template.render(**variables)

            # Compile messages
            compiled_messages: List[Message] = []
            if self.messages:
                for message in self.messages:
                    template = env.from_string(message.content)
                    compiled_content = template.render(**variables)
                    compiled_message = Message(
                        role=message.role,
                        content=compiled_content,
                    )
                    compiled_messages.append(compiled_message)

            # Return simplified CompiledPrompt with variables preserved
            return CompiledPrompt(
                original=self,
                prompt=compiled_prompt,
                compiled_messages=compiled_messages,
                variables=variables.copy(),
            )

        except UndefinedError as error:
            template_str = self.prompt or str(self.messages)
            raise PromptCompilationError(
                f"Failed to compile prompt template: {str(error)}", template_str, error
            )
        except Exception as error:
            template_str = self.prompt or str(self.messages)
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


class CompiledPrompt(BaseModel):
    """
    Represents a compiled prompt with compiled content and original variables
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    original: Prompt = Field(repr=False)
    prompt: str
    compiled_messages: List[Message] = Field(repr=False)
    variables: TemplateVariables

    @computed_field  # type: ignore[prop-decorator]
    @property
    def messages(self) -> List[Dict[str, str]]:
        """
        Returns the compiled messages as a list of dicts compatible with OpenAI's API.
        """
        return [msg.model_dump() for msg in self.compiled_messages]

    def __getattr__(self, name: str) -> Any:
        """Delegate unknown attributes to original prompt for backward compatibility"""
        return getattr(self.original, name)
