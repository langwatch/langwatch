from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.langy_local_create_request_response_200_request import LangyLocalCreateRequestResponse200Request


T = TypeVar("T", bound="LangyLocalCreateRequestResponse200")


@_attrs_define
class LangyLocalCreateRequestResponse200:
    """
    Attributes:
        request (LangyLocalCreateRequestResponse200Request):
        command (str):
    """

    request: LangyLocalCreateRequestResponse200Request
    command: str

    def to_dict(self) -> dict[str, Any]:
        request = self.request.to_dict()

        command = self.command

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "request": request,
                "command": command,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.langy_local_create_request_response_200_request import LangyLocalCreateRequestResponse200Request

        d = dict(src_dict)
        request = LangyLocalCreateRequestResponse200Request.from_dict(d.pop("request"))

        command = d.pop("command")

        langy_local_create_request_response_200 = cls(
            request=request,
            command=command,
        )

        return langy_local_create_request_response_200
