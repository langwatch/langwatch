from enum import Enum


class PatchApiGatewayV1VirtualKeysByIdBodyConfigGuardrailAttachmentsItemDirection(str, Enum):
    POST = "post"
    PRE = "pre"
    STREAM_CHUNK = "stream_chunk"

    def __str__(self) -> str:
        return str(self.value)
