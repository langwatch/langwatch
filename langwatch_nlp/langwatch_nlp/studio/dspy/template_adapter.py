from typing import Any, Type, cast
import dspy
from dspy.signatures.signature import Signature
from dspy.adapters.types.image import try_expand_image_tags

from langwatch_nlp.studio.utils import SerializableWithStringFallback
from pydantic import Field


class TemplateAdapter(dspy.JSONAdapter):
    """
    This is a "TemplateAdapter" DSPy Adapter, that avoid modifying the messages as much as possible,
    and instead uses a {{mustache}} template formating to fill in the inputs on the messages.

    This adapter does not append any text to the system prompt like DSPy normally does and uses json for the outputs
    by default, this matches much better what users expect comming from OpenAI standards, and will allow them to simply
    pick up the same prompts and json schemas and use in any other frameworks as is, since all of them adhere to the
    raw OpenAI way of interating with LLMs.
    """

    def format(
        self,
        signature: Type[Signature],
        demos: list[dict[str, Any]],
        inputs: dict[str, Any],
    ) -> list[dict[str, Any]]:
        inputs_copy = dict(inputs)

        # If the signature and inputs have conversation history, we need to format the conversation history and
        # remove the history field from the signature.
        history_field_name = cast(str, self._get_history_field_name(signature))
        if history_field_name:
            # In order to format the conversation history, we need to remove the history field from the signature.
            signature_without_history = signature.delete(history_field_name)
            conversation_history = self.format_conversation_history(
                signature_without_history,
                history_field_name,
                inputs_copy,
            )

        _messages = getattr(signature, "_messages", Field(default=[])).default

        messages = []
        messages.append(
            {
                "role": "system",
                "content": self._format_template_inputs(
                    signature.instructions, inputs_copy
                ),
            }
        )
        messages.extend(self.format_demos(signature, demos))
        if history_field_name:
            messages.extend(conversation_history)
        messages.extend(
            [
                m | {"content": self._format_template_inputs(m["content"], inputs_copy)}
                for m in _messages
            ]
        )

        messages = try_expand_image_tags(messages)

        return messages

    def _format_template_inputs(
        self, template: str, inputs: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Format the template inputs filling the {{ input }} placeholders.
        """

        class SafeDict(dict):
            def __missing__(self, key):
                return "{{" + key + "}}"

        template_fmt = template.replace("{{", "{").replace("}}", "}")
        str_inputs: dict[str, str] = {}
        for k, v in inputs.items():
            str_inputs[k] = (
                v
                if type(v) == str
                else json.dumps(v, cls=SerializableWithStringFallback)
            )
        return template_fmt.format_map(SafeDict(str_inputs))  # type: ignore
