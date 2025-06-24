import { Input } from "@chakra-ui/react";
import { toaster } from "../components/ui/toaster";
import { InputGroup, type InputGroupProps } from "./ui/input-group";
import { useState } from "react";
import { FiCopy, FiEye, FiEyeOff } from "react-icons/fi";

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
  } & Omit<InputGroupProps, "children">
) {
  const [visible, setVisible] = useState(false);
  const isSecure = !!props.secureMode;

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
          toaster.create({
            title: `Your browser does not support clipboard access, please copy the ${props.label} manually`,
            type: "error",
            duration: 2000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          return;
        }

        void (async () => {
          await navigator.clipboard.writeText(props.value);
          toaster.create({
            title: `${props.label} copied to your clipboard`,
            type: "success",
            duration: 2000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
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
              onClick={e => {
                e.stopPropagation();
                setVisible(v => !v);
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
          backgroundColor: "gray.50",
        }}
      />
    </InputGroup>
  );
}
