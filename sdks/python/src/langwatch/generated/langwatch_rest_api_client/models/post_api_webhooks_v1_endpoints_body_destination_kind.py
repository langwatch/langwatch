from enum import Enum


class PostApiWebhooksV1EndpointsBodyDestinationKind(str, Enum):
    HTTP = "http"
    SQS = "sqs"

    def __str__(self) -> str:
        return str(self.value)
