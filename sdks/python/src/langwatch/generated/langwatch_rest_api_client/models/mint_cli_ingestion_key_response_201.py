from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.mint_cli_ingestion_key_response_201_project import MintCliIngestionKeyResponse201Project


T = TypeVar("T", bound="MintCliIngestionKeyResponse201")


@_attrs_define
class MintCliIngestionKeyResponse201:
    """
    Attributes:
        token (str):
        prefix (str):
        endpoint (str):
        project (MintCliIngestionKeyResponse201Project | Unset):
    """

    token: str
    prefix: str
    endpoint: str
    project: MintCliIngestionKeyResponse201Project | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        token = self.token

        prefix = self.prefix

        endpoint = self.endpoint

        project: dict[str, Any] | Unset = UNSET
        if not isinstance(self.project, Unset):
            project = self.project.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "token": token,
                "prefix": prefix,
                "endpoint": endpoint,
            }
        )
        if project is not UNSET:
            field_dict["project"] = project

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.mint_cli_ingestion_key_response_201_project import MintCliIngestionKeyResponse201Project

        d = dict(src_dict)
        token = d.pop("token")

        prefix = d.pop("prefix")

        endpoint = d.pop("endpoint")

        _project = d.pop("project", UNSET)
        project: MintCliIngestionKeyResponse201Project | Unset
        if isinstance(_project, Unset):
            project = UNSET
        else:
            project = MintCliIngestionKeyResponse201Project.from_dict(_project)

        mint_cli_ingestion_key_response_201 = cls(
            token=token,
            prefix=prefix,
            endpoint=endpoint,
            project=project,
        )

        return mint_cli_ingestion_key_response_201
