/** Read-only field with copy, show/hide toggle, and clipboard handler. */

import { Input } from "@chakra-ui/react";
import { InputGroup, type InputGroupProps } from "@langwatch/design-system/input-group";
import { Copy as FiCopy, Eye as FiEye, EyeOff as FiEyeOff } from "lucide-react";
import { useState } from "react";

import { useOrganizationHost } from "../../model/organization-host.ts";

export function CopyInput(
  props: {
    value: string;
    label: string;
    onClick?: () => void;

    /**
     * If true, the input will be hidden (masked) by default, with a toggle to show/hide the value.
     * Copy will always copy the real value.
     */
    secureMode?: boolean;
  } & Omit<InputGroupProps, "children">,
) {
  const [visible, setVisible] = useState(false);
  const isSecure = !!props.secureMode;
  const host = useOrganizationHost();

  return (
    <InputGroup
      {...props}
      fontFamily={"monospace"}
      width="full"
      cursor="pointer"
      onClick={() => {
        if (props.onClick) {
          props.onClick();
        }

        if (!navigator.clipboard) {
          // A refusal the BROWSER made, so there is no failure to hand over and
          // no code for the registry to look up. The host still reports it, so
          // it reads like every other failure in the product rather than like a
          // toast this element invented.
          host.failed({
            error: void 0,
            fallbackTitle: "Couldn't copy",
            description: `This browser does not allow clipboard access. Copy the ${props.label} manually.`,
          });
          return;
        }

        void (async () => {
          await navigator.clipboard.writeText(props.value);
          host.succeeded({ title: `${props.label} copied to your clipboard` });
        })();
      }}
      endElement={
        <>
          {isSecure && (
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                marginLeft: 8,
                padding: 0,
                color: "#888",
              }}
              aria-label={visible ? `Hide ${props.label}` : `Show ${props.label}`}
              onClick={(e) => {
                e.stopPropagation();
                setVisible((v) => !v);
              }}
            >
              {visible ? <FiEyeOff size={18} /> : <FiEye size={18} />}
            </button>
          )}
          <FiCopy size={18} style={{ marginLeft: isSecure ? 8 : 0 }} />
        </>
      }
    >
      <Input
        cursor="pointer"
        type={isSecure && !visible ? "password" : "text"}
        value={props.value}
        readOnly
        style={{ paddingRight: isSecure ? "4rem" : "2rem" }}
        _hover={{
          backgroundColor: "bg.subtle",
        }}
      />
    </InputGroup>
  );
}
