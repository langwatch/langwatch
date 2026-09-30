/**
 * Read-only copy field that routes clipboard writes through the HOST host, not a
 * toaster, so failed copies don't falsely confirm when handling credentials.
 */

import { Input } from "@chakra-ui/react";
import { InputGroup, type InputGroupProps } from "@langwatch/design-system/input-group";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { useAuthorizeHost } from "../../model/authorize-host.ts";

export function CopyInput(
  props: {
    value: string;
    label: string;
    onClick?: () => void;
    /** Called once the clipboard write has succeeded. */
    onCopied?: () => void;
    /**
     * Masks the field until the reader asks to see it. Copy always copies the
     * real value.
     */
    secureMode?: boolean;
  } & Omit<InputGroupProps, "children">,
) {
  const host = useAuthorizeHost();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const isSecure = !!props.secureMode;
  const { onCopied, ...groupProps } = props;

  return (
    <InputGroup
      {...groupProps}
      fontFamily="monospace"
      width="full"
      cursor="pointer"
      onClick={() => {
        props.onClick?.();
        void host
          .copyToClipboard({
            text: props.value,
            succeeded: { title: `${props.label} copied to your clipboard` },
          })
          .then((succeeded) => {
            if (!succeeded) return;
            setCopied(true);
            onCopied?.();
            setTimeout(() => setCopied(false), 2500);
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
          {copied ? (
            <output style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Check size={18} />
              Copied
            </output>
          ) : (
            <Copy size={18} style={{ marginLeft: isSecure ? 8 : 0 }} />
          )}
        </>
      }
    >
      <Input
        cursor="pointer"
        type={isSecure && !visible ? "password" : "text"}
        value={props.value}
        data-testid={`copy-input-${props.label.toLowerCase().replaceAll(" ", "-")}`}
        readOnly
        style={{ paddingRight: inputPaddingRight({ isSecure, copied }) }}
        _hover={{ backgroundColor: "bg.subtle" }}
      />
    </InputGroup>
  );
}

/** Room on the right for the eye toggle, or the "Copied" note, or just the copy icon. */
function inputPaddingRight({ isSecure, copied }: { isSecure: boolean; copied: boolean }) {
  if (isSecure) return "4rem";
  return copied ? "6rem" : "2rem";
}
