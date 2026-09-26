from enum import Enum


class PollLangyControlSessionResponse200FramesItemType1Code(str, Enum):
    API_KEY_INVALID = "api_key_invalid"
    CONVERSATION_MISMATCH = "conversation_mismatch"
    KEY_TYPE_NOT_ALLOWED = "key_type_not_allowed"
    PROTOCOL_INVALID = "protocol_invalid"
    REPLICA_COUNT_UNSUPPORTED = "replica_count_unsupported"
    WORKSPACE_ALREADY_CONNECTED = "workspace_already_connected"

    def __str__(self) -> str:
        return str(self.value)
