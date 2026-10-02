from enum import Enum


class DeleteApiAnnotationsIdResponse404Error(str, Enum):
    ANNOTATION_NOT_FOUND = "annotation_not_found"

    def __str__(self) -> str:
        return str(self.value)
