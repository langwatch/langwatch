from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.update_test_suite_response_200_evaluators_item import UpdateTestSuiteResponse200EvaluatorsItem
    from ..models.update_test_suite_response_200_fields_item import UpdateTestSuiteResponse200FieldsItem


T = TypeVar("T", bound="UpdateTestSuiteResponse200")


@_attrs_define
class UpdateTestSuiteResponse200:
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
        fields (list[UpdateTestSuiteResponse200FieldsItem] | Unset): The fields the test suite declares. Absent on
            servers that predate fields on this family.
        evaluators (list[UpdateTestSuiteResponse200EvaluatorsItem] | Unset): The evaluators attached to the test suite.
            Absent on servers that predate evaluators on this family.
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
    fields: list[UpdateTestSuiteResponse200FieldsItem] | Unset = UNSET
    evaluators: list[UpdateTestSuiteResponse200EvaluatorsItem] | Unset = UNSET
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

        fields: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.fields, Unset):
            fields = []
            for fields_item_data in self.fields:
                fields_item = fields_item_data.to_dict()
                fields.append(fields_item)

        evaluators: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.evaluators, Unset):
            evaluators = []
            for evaluators_item_data in self.evaluators:
                evaluators_item = evaluators_item_data.to_dict()
                evaluators.append(evaluators_item)

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
        if fields is not UNSET:
            field_dict["fields"] = fields
        if evaluators is not UNSET:
            field_dict["evaluators"] = evaluators

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_test_suite_response_200_evaluators_item import UpdateTestSuiteResponse200EvaluatorsItem
        from ..models.update_test_suite_response_200_fields_item import UpdateTestSuiteResponse200FieldsItem

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

        _fields = d.pop("fields", UNSET)
        fields: list[UpdateTestSuiteResponse200FieldsItem] | Unset = UNSET
        if _fields is not UNSET:
            fields = []
            for fields_item_data in _fields:
                fields_item = UpdateTestSuiteResponse200FieldsItem.from_dict(fields_item_data)

                fields.append(fields_item)

        _evaluators = d.pop("evaluators", UNSET)
        evaluators: list[UpdateTestSuiteResponse200EvaluatorsItem] | Unset = UNSET
        if _evaluators is not UNSET:
            evaluators = []
            for evaluators_item_data in _evaluators:
                evaluators_item = UpdateTestSuiteResponse200EvaluatorsItem.from_dict(evaluators_item_data)

                evaluators.append(evaluators_item)

        update_test_suite_response_200 = cls(
            id=id,
            name=name,
            slug=slug,
            scenario_ids=scenario_ids,
            scenario_count=scenario_count,
            archived_at=archived_at,
            created_at=created_at,
            updated_at=updated_at,
            platform_url=platform_url,
            fields=fields,
            evaluators=evaluators,
        )

        update_test_suite_response_200.additional_properties = d
        return update_test_suite_response_200

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
