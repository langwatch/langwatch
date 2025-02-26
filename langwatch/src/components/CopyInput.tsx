import { Input } from "@chakra-ui/react";
import { Copy } from "react-feather";
import { toaster } from "../components/ui/toaster";
import { InputGroup, type InputGroupProps } from "./ui/input-group";

export function CopyInput(
  props: {
    value: string;
    label: string;
    onClick?: () => void;
  } & Omit<InputGroupProps, "children">
) {
  return (
    <InputGroup
      {...props}
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
      endElement={<Copy />}
    >
      <Input
        cursor="pointer"
        type="text"
        value={props.value}
        readOnly
        _hover={{
          backgroundColor: "gray.50",
        }}
      />
    </InputGroup>
  );
}
