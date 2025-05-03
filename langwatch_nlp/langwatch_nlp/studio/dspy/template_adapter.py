import json
import re
from typing import Any, Type, cast
import dspy
from dspy.signatures.signature import Signature, _default_instructions
from dspy.adapters.types.image import try_expand_image_tags

from dspy.adapters.chat_adapter import ChatAdapter
from dspy.adapters.json_adapter import _get_structured_outputs_response_format
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

    def __call__(
        self,
        lm,
        lm_kwargs: dict[str, Any],
        signature: Type[Signature],
        demos: list[dict[str, Any]],
        inputs: dict[str, Any],
    ) -> list[dict[str, Any]]:
        # If the signature has only one output field and it's a string, we can use the text only completion
        if self._use_text_only_completion(signature, inputs):
            return ChatAdapter.__call__(self, lm, lm_kwargs, signature, demos, inputs)  # type: ignore

        # Replace the DSPyProgramOutputs title from the json schema with the signature name to bias the LLM in the right direction instead of randomly towards DSPy
        model = _get_structured_outputs_response_format(signature)
        schema = model.model_json_schema()
        if schema.get("title", None) == "DSPyProgramOutputs":
            new_name = signature.__name__.replace("Signature", "")
            schema["title"] = new_name
            model.__name__ = new_name
            model.model_json_schema = lambda *args, **kwargs: schema
        lm_kwargs["response_format"] = model
        return ChatAdapter.__call__(self, lm, lm_kwargs, signature, demos, inputs)  # type: ignore

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

        instructions = signature.instructions
        if instructions == _default_instructions(signature):
            instructions = ""

        messages = []
        messages.append(
            {
                "role": "system",
                "content": self._format_template_inputs(instructions, inputs_copy),
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

        # Normalize template: shrink all {{   anything    }} to {{anything}}
        template_clean = re.sub(r"{{\s*(.*?)\s*}}", r"{{\1}}", template)
        template_fmt = template_clean.replace("{{", "{").replace("}}", "}")
        str_inputs: dict[str, str] = {}
        for k, v in inputs.items():
            str_inputs[k] = (
                v
                if type(v) == str
                else json.dumps(v, cls=SerializableWithStringFallback)
            )
        return template_fmt.format_map(SafeDict(str_inputs))  # type: ignore

    def parse(self, signature, completion):
        if len(signature.output_fields) == 0:
            return {}

        first_field = list(signature.output_fields.items())[0]
        if self._use_text_only_completion(signature, completion):
            return {first_field[0]: completion}

        return super().parse(signature, completion)

    def _use_text_only_completion(self, signature, completion):
        return len(signature.output_fields) == 0 or (
            len(signature.output_fields) == 1
            and list(signature.output_fields.values())[0].annotation == str
        )
