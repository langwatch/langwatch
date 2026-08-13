from enum import Enum


class ListWebhookEndpointDeliveriesResponse200DataItemOutcome(str, Enum):
    PENDING = "pending"
    RETRYABLE = "retryable"
    SUCCESS = "success"
    TERMINAL = "terminal"

    def __str__(self) -> str:
        return str(self.value)
