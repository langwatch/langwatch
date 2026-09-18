from enum import Enum


class RegisterLangyControlSessionBodyType(str, Enum):
    REGISTER = "register"

    def __str__(self) -> str:
        return str(self.value)
