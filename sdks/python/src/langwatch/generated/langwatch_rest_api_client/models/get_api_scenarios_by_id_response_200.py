from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_api_scenarios_by_id_response_200_parameters_item import (
        GetApiScenariosByIdResponse200ParametersItem,
    )


T = TypeVar("T", bound="GetApiScenariosByIdResponse200")


@_attrs_define
class GetApiScenariosByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        situation (str):
        criteria (list[str]):
        labels (list[str]):
        parameters (list[GetApiScenariosByIdResponse200ParametersItem]):
        platform_url (str):
        folder_id (None | str | Unset): The test suite (folder) this scenario is filed in, or null when unfiled. Absent
            on servers that predate test suites.
    """

    id: str
    name: str
    situation: str
    criteria: list[str]
    labels: list[str]
    parameters: list[GetApiScenariosByIdResponse200ParametersItem]
    platform_url: str
    folder_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        situation = self.situation

        criteria = self.criteria

        labels = self.labels

        parameters = []
        for parameters_item_data in self.parameters:
            parameters_item = parameters_item_data.to_dict()
            parameters.append(parameters_item)

        platform_url = self.platform_url

        folder_id: None | str | Unset
        if isinstance(self.folder_id, Unset):
            folder_id = UNSET
        else:
            folder_id = self.folder_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "situation": situation,
                "criteria": criteria,
                "labels": labels,
                "parameters": parameters,
                "platformUrl": platform_url,
            }
        )
        if folder_id is not UNSET:
            field_dict["folderId"] = folder_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_scenarios_by_id_response_200_parameters_item import (
            GetApiScenariosByIdResponse200ParametersItem,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        situation = d.pop("situation")

        criteria = cast(list[str], d.pop("criteria"))

        labels = cast(list[str], d.pop("labels"))

        parameters = []
        _parameters = d.pop("parameters")
        for parameters_item_data in _parameters:
            parameters_item = GetApiScenariosByIdResponse200ParametersItem.from_dict(parameters_item_data)

            parameters.append(parameters_item)

        platform_url = d.pop("platformUrl")

        def _parse_folder_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        folder_id = _parse_folder_id(d.pop("folderId", UNSET))

        get_api_scenarios_by_id_response_200 = cls(
            id=id,
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            parameters=parameters,
            platform_url=platform_url,
            folder_id=folder_id,
        )

        get_api_scenarios_by_id_response_200.additional_properties = d
        return get_api_scenarios_by_id_response_200

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
