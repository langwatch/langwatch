from .formatter import PromptFormatter
from typing import List, Any
from openai.types.chat import ChatCompletionMessageParam


class Prompt:
    """
    A class representing a prompt configuration that can be used with OpenAI's API.
    Handles formatting messages with variables.
    """

    def __init__(self, config: Any, formatter: PromptFormatter = PromptFormatter()):
        self._config = config
        self._formatter = formatter

    def format_messages(self, **variables: Any) -> List[ChatCompletionMessageParam]:
        """
        Formats the prompt messages with the provided variables.
        Returns a list of message dictionaries ready for OpenAI's API.

        Args:
            **variables: Variables to format the prompt messages with

        Returns:
            List[Dict[str, str]]: List of formatted messages

        Raises:
            MissingPromptVariableError: If required variables are missing
        """
        return [
            {
                "role": msg.role.value,
                "content": self._formatter.format(msg.content, variables),
            }
            for msg in self._config.messages
        ]

    @property
    def model(self) -> str:
        """Returns the model specified in the prompt configuration."""
        return self._config.model

    @property
    def name(self) -> str:
        """Returns the name of the prompt."""
        return self._config.name

    @property
    def id(self) -> str:
        """Returns the ID of the prompt."""
        return self._config.id

    @property
    def version_number(self) -> int:
        """Returns the version number of the prompt."""
        return self._config.version

    @property
    def version_id(self) -> str:
        """Returns the version ID of the prompt."""
        return self._config.version_id

    def raw_config(self) -> Any:
        """Returns the raw prompt configuration."""
        return self._config
