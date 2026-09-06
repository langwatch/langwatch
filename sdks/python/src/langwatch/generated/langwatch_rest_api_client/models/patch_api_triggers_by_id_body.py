from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_api_triggers_by_id_body_alert_type_type_1 import PatchApiTriggersByIdBodyAlertTypeType1
from ..models.patch_api_triggers_by_id_body_alert_type_type_2_type_1 import PatchApiTriggersByIdBodyAlertTypeType2Type1
from ..models.patch_api_triggers_by_id_body_alert_type_type_3_type_1 import PatchApiTriggersByIdBodyAlertTypeType3Type1
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_api_triggers_by_id_body_action_params import PatchApiTriggersByIdBodyActionParams
    from ..models.patch_api_triggers_by_id_body_filters import PatchApiTriggersByIdBodyFilters


T = TypeVar("T", bound="PatchApiTriggersByIdBody")


@_attrs_define
class PatchApiTriggersByIdBody:
    """
    Attributes:
        name (str | Unset):
        active (bool | Unset):
        message (None | str | Unset):
        alert_type (None | PatchApiTriggersByIdBodyAlertTypeType1 | PatchApiTriggersByIdBodyAlertTypeType2Type1 |
            PatchApiTriggersByIdBodyAlertTypeType3Type1 | Unset):
        filters (PatchApiTriggersByIdBodyFilters | Unset):
        action_params (PatchApiTriggersByIdBodyActionParams | Unset):
    """

    name: str | Unset = UNSET
    active: bool | Unset = UNSET
    message: None | str | Unset = UNSET
    alert_type: (
        None
        | PatchApiTriggersByIdBodyAlertTypeType1
        | PatchApiTriggersByIdBodyAlertTypeType2Type1
        | PatchApiTriggersByIdBodyAlertTypeType3Type1
        | Unset
    ) = UNSET
    filters: PatchApiTriggersByIdBodyFilters | Unset = UNSET
    action_params: PatchApiTriggersByIdBodyActionParams | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        active = self.active

        message: None | str | Unset
        if isinstance(self.message, Unset):
            message = UNSET
        else:
            message = self.message

        alert_type: None | str | Unset
        if isinstance(self.alert_type, Unset):
            alert_type = UNSET
        elif isinstance(self.alert_type, PatchApiTriggersByIdBodyAlertTypeType1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, PatchApiTriggersByIdBodyAlertTypeType2Type1):
            alert_type = self.alert_type.value
        elif isinstance(self.alert_type, PatchApiTriggersByIdBodyAlertTypeType3Type1):
            alert_type = self.alert_type.value
        else:
            alert_type = self.alert_type

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        action_params: dict[str, Any] | Unset = UNSET
        if not isinstance(self.action_params, Unset):
            action_params = self.action_params.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if active is not UNSET:
            field_dict["active"] = active
        if message is not UNSET:
            field_dict["message"] = message
        if alert_type is not UNSET:
            field_dict["alertType"] = alert_type
        if filters is not UNSET:
            field_dict["filters"] = filters
        if action_params is not UNSET:
            field_dict["actionParams"] = action_params

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_api_triggers_by_id_body_action_params import PatchApiTriggersByIdBodyActionParams
        from ..models.patch_api_triggers_by_id_body_filters import PatchApiTriggersByIdBodyFilters

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        active = d.pop("active", UNSET)

        def _parse_message(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        message = _parse_message(d.pop("message", UNSET))

        def _parse_alert_type(
            data: object,
        ) -> (
            None
            | PatchApiTriggersByIdBodyAlertTypeType1
            | PatchApiTriggersByIdBodyAlertTypeType2Type1
            | PatchApiTriggersByIdBodyAlertTypeType3Type1
            | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_1 = PatchApiTriggersByIdBodyAlertTypeType1(data)

                return alert_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_2_type_1 = PatchApiTriggersByIdBodyAlertTypeType2Type1(data)

                return alert_type_type_2_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, str):
                    raise TypeError()
                alert_type_type_3_type_1 = PatchApiTriggersByIdBodyAlertTypeType3Type1(data)

                return alert_type_type_3_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | PatchApiTriggersByIdBodyAlertTypeType1
                | PatchApiTriggersByIdBodyAlertTypeType2Type1
                | PatchApiTriggersByIdBodyAlertTypeType3Type1
                | Unset,
                data,
            )

        alert_type = _parse_alert_type(d.pop("alertType", UNSET))

        _filters = d.pop("filters", UNSET)
        filters: PatchApiTriggersByIdBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PatchApiTriggersByIdBodyFilters.from_dict(_filters)

        _action_params = d.pop("actionParams", UNSET)
        action_params: PatchApiTriggersByIdBodyActionParams | Unset
        if isinstance(_action_params, Unset):
            action_params = UNSET
        else:
            action_params = PatchApiTriggersByIdBodyActionParams.from_dict(_action_params)

        patch_api_triggers_by_id_body = cls(
            name=name,
            active=active,
            message=message,
            alert_type=alert_type,
            filters=filters,
            action_params=action_params,
        )

        patch_api_triggers_by_id_body.additional_properties = d
        return patch_api_triggers_by_id_body

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
