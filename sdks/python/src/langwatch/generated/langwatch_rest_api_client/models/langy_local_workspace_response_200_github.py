from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="LangyLocalWorkspaceResponse200Github")


@_attrs_define
class LangyLocalWorkspaceResponse200Github:
    """
    Attributes:
        installed (bool):
        account_login (str | Unset):
    """

    installed: bool
    account_login: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        installed = self.installed

        account_login = self.account_login

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "installed": installed,
            }
        )
        if account_login is not UNSET:
            field_dict["accountLogin"] = account_login

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        installed = d.pop("installed")

        account_login = d.pop("accountLogin", UNSET)

        langy_local_workspace_response_200_github = cls(
            installed=installed,
            account_login=account_login,
        )

        return langy_local_workspace_response_200_github
