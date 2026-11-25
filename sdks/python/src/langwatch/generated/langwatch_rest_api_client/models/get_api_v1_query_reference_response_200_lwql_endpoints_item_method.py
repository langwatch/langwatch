from enum import Enum


class GetApiV1QueryReferenceResponse200LwqlEndpointsItemMethod(str, Enum):
    GET = "GET"
    POST = "POST"

    def __str__(self) -> str:
        return str(self.value)
