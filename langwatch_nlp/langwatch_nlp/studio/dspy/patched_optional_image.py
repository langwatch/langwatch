from typing import Any, Union

from pydantic.fields import FieldInfo

from dspy.adapters.image_utils import Image
import dspy.adapters.chat_adapter

_original_format_field_value = dspy.adapters.chat_adapter.format_field_value


def patch_optional_image():
    def format_field_value(
        field_info: FieldInfo, value: Any, assume_text=True
    ) -> Union[str, dict]:
        if field_info.annotation == Image and not value:
            return {"type": "text", "text": "None"}

        return _original_format_field_value(field_info, value, assume_text)

    dspy.adapters.chat_adapter.format_field_value = format_field_value
