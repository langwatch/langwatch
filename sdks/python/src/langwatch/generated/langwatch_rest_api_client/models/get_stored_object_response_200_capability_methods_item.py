from enum import Enum


class GetStoredObjectResponse200CapabilityMethodsItem(str, Enum):
    GET = "GET"
    HEAD = "HEAD"

    def __str__(self) -> str:
        return str(self.value)
