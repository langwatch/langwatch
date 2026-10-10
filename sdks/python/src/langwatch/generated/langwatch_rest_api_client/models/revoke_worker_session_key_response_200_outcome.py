from enum import Enum


class RevokeWorkerSessionKeyResponse200Outcome(str, Enum):
    ALREADY_REVOKED = "already_revoked"
    NOT_FOUND = "not_found"
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
