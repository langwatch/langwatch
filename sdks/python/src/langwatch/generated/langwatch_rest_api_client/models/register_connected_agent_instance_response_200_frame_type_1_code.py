from enum import Enum


class RegisterConnectedAgentInstanceResponse200FrameType1Code(str, Enum):
    API_KEY_INVALID = "api_key_invalid"
    ENVIRONMENT_INVALID = "environment_invalid"
    KEY_TYPE_NOT_ALLOWED = "key_type_not_allowed"
    PARAMETERS_INVALID = "parameters_invalid"
    PERMISSION_DENIED = "permission_denied"
    PROJECT_REQUIRED = "project_required"
    PROTOCOL_INVALID = "protocol_invalid"
    REPLICA_COUNT_UNSUPPORTED = "replica_count_unsupported"

    def __str__(self) -> str:
        return str(self.value)
