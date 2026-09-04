from enum import Enum


class PatchApiWebhooksV1EndpointsByIdBodyDestinationKind(str, Enum):
    HTTP = "http"
    SQS = "sqs"

    def __str__(self) -> str:
        return str(self.value)
