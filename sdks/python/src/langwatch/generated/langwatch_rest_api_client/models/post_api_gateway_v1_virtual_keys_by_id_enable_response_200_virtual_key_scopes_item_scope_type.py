from enum import Enum


class PostApiGatewayV1VirtualKeysByIdEnableResponse200VirtualKeyScopesItemScopeType(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"
    TEAM = "team"

    def __str__(self) -> str:
        return str(self.value)
