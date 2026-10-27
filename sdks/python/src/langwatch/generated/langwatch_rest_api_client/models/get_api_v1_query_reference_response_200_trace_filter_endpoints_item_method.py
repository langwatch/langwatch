from enum import Enum


class GetApiV1QueryReferenceResponse200TraceFilterEndpointsItemMethod(str, Enum):
    GET = "GET"
    POST = "POST"

    def __str__(self) -> str:
        return str(self.value)
