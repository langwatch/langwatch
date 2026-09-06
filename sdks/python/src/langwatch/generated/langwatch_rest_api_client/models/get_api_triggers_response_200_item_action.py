from enum import Enum


class GetApiTriggersResponse200ItemAction(str, Enum):
    ADD_TO_ANNOTATION_QUEUE = "ADD_TO_ANNOTATION_QUEUE"
    ADD_TO_DATASET = "ADD_TO_DATASET"
    SEND_EMAIL = "SEND_EMAIL"
    SEND_SLACK_MESSAGE = "SEND_SLACK_MESSAGE"

    def __str__(self) -> str:
        return str(self.value)
