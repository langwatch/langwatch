from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_triggers_by_id_response_200_action import PatchApiTriggersByIdResponse200Action
from ..models.patch_api_triggers_by_id_response_200_alert_type_type_1 import (
    PatchApiTriggersByIdResponse200AlertTypeType1,
)
from ..models.patch_api_triggers_by_id_response_200_alert_type_type_2_type_1 import (
    PatchApiTriggersByIdResponse200AlertTypeType2Type1,
)
from ..models.patch_api_triggers_by_id_response_200_alert_type_type_3_type_1 import (
    PatchApiTriggersByIdResponse200AlertTypeType3Type1,
)

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_response_200_action_params import PatchApiTriggersByIdResponse200ActionParams
    from ..models.patch_api_triggers_by_id_response_200_filters import PatchApiTriggersByIdResponse200Filters


T = TypeVar("T", bound="PatchApiTriggersByIdResponse200")


@_attrs_define
class PatchApiTriggersByIdResponse200:
    """
    Attributes:
        id (str):
        name (str):
        action (PatchApiTriggersByIdResponse200Action):
        action_params (PatchApiTriggersByIdResponse200ActionParams):
        filters (PatchApiTriggersByIdResponse200Filters):
        active (bool):
        message (None | str):
        alert_type (None | PatchApiTriggersByIdResponse200AlertTypeType1 |
            PatchApiTriggersByIdResponse200AlertTypeType2Type1 | PatchApiTriggersByIdResponse200AlertTypeType3Type1):
        created_at (str):
        updated_at (str):
    """

    id: str
    name: str
    action: PatchApiTriggersByIdResponse200Action
    action_params: PatchApiTriggersByIdResponse200ActionParams
    filters: PatchApiTriggersByIdResponse200Filters
    active: bool
    message: None | str
    alert_type: (
        None
        | PatchApiTriggersByIdResponse200AlertTypeType1
        | PatchApiTriggersByIdResponse200AlertTypeType2Type1
        | PatchApiTriggersByIdResponse200AlertTypeType3Type1
    )
    created_at: str
    updated_at: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        action = self.action.value

        action_params = self.action_params.to_dict()

        filters = self.filters.to_dict()

        active = self.active

        message: None | str
        message = self.message

        alert_type: None | str
        if isinstance(self.alert_type, PatchApiTriggersByIdResponse200AlertTypeType1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, PatchApiTriggersByIdResponse200AlertTypeType2Type1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, PatchApiTriggersByIdResponse200AlertTypeType3Type1):
            alert_type = self.alert_type.value
        else:
            alert_type = self.alert_type

        created_at = self.created_at

        updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "action": action,
                "actionParams": action_params,
                "filters": filters,
                "active": active,
                "message": message,
                "alertType": alert_type,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_response_200_action_params import (
            PatchApiTriggersByIdResponse200ActionParams,
        )
        from ..models.patch_api_triggers_by_id_response_200_filters import PatchApiTriggersByIdResponse200Filters

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        action = PatchApiTriggersByIdResponse200Action(d.pop("action"))

        action_params = PatchApiTriggersByIdResponse200ActionParams.from_dict(d.pop("actionParams"))

        filters = PatchApiTriggersByIdResponse200Filters.from_dict(d.pop("filters"))

        active = d.pop("active")

        def _parse_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        message = _parse_message(d.pop("message"))

        def _parse_alert_type(
            data: object,
        ) -> (
            None
            | PatchApiTriggersByIdResponse200AlertTypeType1
            | PatchApiTriggersByIdResponse200AlertTypeType2Type1
            | PatchApiTriggersByIdResponse200AlertTypeType3Type1
        ):
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_1 = PatchApiTriggersByIdResponse200AlertTypeType1(data)

                return alert_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_2_type_1 = PatchApiTriggersByIdResponse200AlertTypeType2Type1(data)

                return alert_type_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_3_type_1 = PatchApiTriggersByIdResponse200AlertTypeType3Type1(data)

                return alert_type_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | PatchApiTriggersByIdResponse200AlertTypeType1
                | PatchApiTriggersByIdResponse200AlertTypeType2Type1
                | PatchApiTriggersByIdResponse200AlertTypeType3Type1,
                data,
            )

        alert_type = _parse_alert_type(d.pop("alertType"))

        created_at = d.pop("createdAt")

        updated_at = d.pop("updatedAt")

        patch_api_triggers_by_id_response_200 = cls(
            id=id,
            name=name,
            action=action,
            action_params=action_params,
            filters=filters,
            active=active,
            message=message,
            alert_type=alert_type,
            created_at=created_at,
            updated_at=updated_at,
        )

        patch_api_triggers_by_id_response_200.additional_properties = d
        return patch_api_triggers_by_id_response_200

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
