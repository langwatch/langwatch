from enum import Enum


class PostApiGovernanceIngestionTemplatesBodyCredentialSchemaType0(str, Enum):
    AGENT_ID = "agent_id"
    OTLP_TOKEN = "otlp_token"
    STATIC_API_KEY = "static_api_key"

    def __str__(self) -> str:
        return str(self.value)
