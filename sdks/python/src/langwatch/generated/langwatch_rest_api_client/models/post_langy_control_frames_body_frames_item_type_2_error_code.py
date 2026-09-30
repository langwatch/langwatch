from enum import Enum


class PostLangyControlFramesBodyFramesItemType2ErrorCode(str, Enum):
    CANCELLED = "cancelled"
    COMMAND_REFUSED = "command_refused"
    EXEC_FAILED = "exec_failed"
    NOT_FOUND = "not_found"
    PATH_REFUSED = "path_refused"
    PERMISSION_DENIED = "permission_denied"
    PERMISSION_EXPIRED = "permission_expired"
    TIMEOUT = "timeout"

    def __str__(self) -> str:
        return str(self.value)
