/**
 * A read-only field whose whole job is being copied.
 *
 * The THIRD family-local copy of the field `platform/app`'s `components/CopyInput`
 * was — `@langwatch/scim-web` and `@langwatch/organization-web` each took one for
 * the same reason, and the platform original has since been deleted, so there is
 * nothing left to move. The three die together when the field lands in the Design
 * System, where every half could name it.
 *
 * What differs from those two, and deliberately: the clipboard write and the
 * notice go through the HOST rather than through a toaster this element imports.
 * Every copy button in the product says the same thing about a refused write, and
 * saying "copied" for a write that did not happen is worse than saying nothing —
 * which on a page that hands out a credential is the whole point.
 */

import { Input } from "@chakra-ui/react";
import { InputGroup, type InputGroupProps } from "@langwatch/design-system/input-group";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useAuthorizeHost } from "../../model/authorize-host";

export function CopyInput(
  props: {
    value: string;
    label: string;
    onClick?: () => void;
    /**
     * Masks the field until the reader asks to see it. Copy always copies the
     * real value.
     */
    secureMode?: boolean;
  } & Omit<InputGroupProps, "children">,
) {
  const host = useAuthorizeHost();
  const [visible, setVisible] = useState(false);
  const isSecure = !!props.secureMode;

  return (
    <InputGroup
      {...props}
      fontFamily="monospace"
      width="full"
      cursor="pointer"
      onClick={() => {
        props.onClick?.();
        void host.copyToClipboard({
          text: props.value,
          succeeded: { title: `${props.label} copied to your clipboard` },
        });
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
              onClick={(event) => {
                event.stopPropagation();
                setVisible((current) => !current);
              }}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
          <Copy size={18} style={{ marginLeft: isSecure ? 8 : 0 }} />
        </>
      }
    >
      <Input
        cursor="pointer"
        type={isSecure && !visible ? "password" : "text"}
        value={props.value}
        readOnly
        style={{ paddingRight: isSecure ? "4rem" : "2rem" }}
        _hover={{ backgroundColor: "bg.subtle" }}
      />
    </InputGroup>
  );
}
