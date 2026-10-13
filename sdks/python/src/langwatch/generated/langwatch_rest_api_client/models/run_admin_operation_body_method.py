from enum import Enum


class RunAdminOperationBodyMethod(str, Enum):
    CREATE = "create"
    DELETE = "delete"
    DELETEMANY = "deleteMany"
    GETLIST = "getList"
    GETMANY = "getMany"
    GETMANYREFERENCE = "getManyReference"
    GETONE = "getOne"
    UPDATE = "update"
    UPDATEMANY = "updateMany"

    def __str__(self) -> str:
        return str(self.value)
