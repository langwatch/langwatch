from enum import Enum


class PostApiTriggersByIdDisableResponse200Action(str, Enum):
    ADD_TO_ANNOTATION_QUEUE = "ADD_TO_ANNOTATION_QUEUE"
    ADD_TO_DATASET = "ADD_TO_DATASET"
    SEND_EMAIL = "SEND_EMAIL"
    SEND_SLACK_MESSAGE = "SEND_SLACK_MESSAGE"
    SEND_WEBHOOK = "SEND_WEBHOOK"

    def __str__(self) -> str:
        return str(self.value)
