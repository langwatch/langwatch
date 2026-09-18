/**
 * Read-only copy field that routes clipboard writes through the HOST host, not a
 * toaster, so failed copies don't falsely confirm when handling credentials.
 */

import { Input } from "@chakra-ui/react";
import { InputGroup, type InputGroupProps } from "@langwatch/design-system/input-group";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useAuthorizeHost } from "../../model/authorize-host.ts";

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
