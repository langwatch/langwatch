from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.put_api_scenarios_by_id_response_200_parameters_item import (
        PutApiScenariosByIdResponse200ParametersItem,
    )


T = TypeVar("T", bound="PutApiScenariosByIdResponse200")


@_attrs_define
class PutApiScenariosByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        situation (str):
        criteria (list[str]):
        labels (list[str]):
        parameters (list[PutApiScenariosByIdResponse200ParametersItem]):
        folder_id (None | str): The test suite (folder) this scenario is filed in, or null when unfiled.
        platform_url (str):
    """

    id: str
    name: str
    situation: str
    criteria: list[str]
    labels: list[str]
    parameters: list[PutApiScenariosByIdResponse200ParametersItem]
    folder_id: None | str
    platform_url: str
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

        folder_id: None | str
        folder_id = self.folder_id

        platform_url = self.platform_url

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
                "folderId": folder_id,
                "platformUrl": platform_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.put_api_scenarios_by_id_response_200_parameters_item import (
            PutApiScenariosByIdResponse200ParametersItem,
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
            parameters_item = PutApiScenariosByIdResponse200ParametersItem.from_dict(parameters_item_data)

            parameters.append(parameters_item)

        def _parse_folder_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        folder_id = _parse_folder_id(d.pop("folderId"))

        platform_url = d.pop("platformUrl")

        put_api_scenarios_by_id_response_200 = cls(
            id=id,
            name=name,
            situation=situation,
            criteria=criteria,
            labels=labels,
            parameters=parameters,
            folder_id=folder_id,
            platform_url=platform_url,
        )

        put_api_scenarios_by_id_response_200.additional_properties = d
        return put_api_scenarios_by_id_response_200

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
