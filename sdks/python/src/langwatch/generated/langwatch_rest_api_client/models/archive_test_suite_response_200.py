from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ArchiveTestSuiteResponse200")


@_attrs_define
class ArchiveTestSuiteResponse200:
    """
    Attributes:
        id (str): The test suite that was archived.
        archived (bool): Always true once the suite is archived.
    """

    id: str
    archived: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        archived = self.archived

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "archived": archived,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        archived = d.pop("archived")

        archive_test_suite_response_200 = cls(
            id=id,
            archived=archived,
        )

        return archive_test_suite_response_200
