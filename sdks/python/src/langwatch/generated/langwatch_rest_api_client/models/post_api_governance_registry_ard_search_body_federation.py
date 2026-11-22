from enum import Enum


class PostApiGovernanceRegistryArdSearchBodyFederation(str, Enum):
    AUTO = "auto"
    NONE = "none"
    REFERRALS = "referrals"

    def __str__(self) -> str:
        return str(self.value)
