from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="RenameTestSuiteResponse200")


@_attrs_define
class RenameTestSuiteResponse200:
    """
    Attributes:
        id (str): The test suite id.
        name (str): The test suite name.
        slug (str): The suite's address in the platform. It is kept when the suite is renamed.
        scenario_ids (list[str]): The scenarios filed in this suite, in the order it shows them.
        scenario_count (float): How many scenarios are filed in it.
        archived_at (None | str): When the suite was archived, or null while it is active.
        created_at (str): When the suite was created.
        updated_at (str): When the suite was last written.
        platform_url (str): Where to open this test suite in the LangWatch platform.
    """

    id: str
    name: str
    slug: str
    scenario_ids: list[str]
    scenario_count: float
    archived_at: None | str
    created_at: str
    updated_at: str
    platform_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        slug = self.slug

        scenario_ids = self.scenario_ids

        scenario_count = self.scenario_count

        archived_at: None | str
        archived_at = self.archived_at

        created_at = self.created_at

        updated_at = self.updated_at

        platform_url = self.platform_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "slug": slug,
                "scenarioIds": scenario_ids,
                "scenarioCount": scenario_count,
                "archivedAt": archived_at,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        slug = d.pop("slug")

        scenario_ids = cast(list[str], d.pop("scenarioIds"))

        scenario_count = d.pop("scenarioCount")

        def _parse_archived_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        archived_at = _parse_archived_at(d.pop("archivedAt"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        platform_url = d.pop("platformUrl")

        rename_test_suite_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            scenario_ids=scenario_ids,
            scenario_count=scenario_count,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
        )

        rename_test_suite_response_200.additional_properties = d
        return rename_test_suite_response_200

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
