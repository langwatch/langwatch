import {
  Input,
  InputGroup,
  InputRightElement,
  useToast,
  type InputGroupProps,
} from "@chakra-ui/react";
import { Copy } from "react-feather";

export function CopyInput(
  props: {
    value: string;
    label: string;
    onClick?: () => void;
  } & InputGroupProps
) {
  const toast = useToast();

  return (
    <InputGroup
      {...props}
      cursor="pointer"
      onClick={() => {
        if (props.onClick) {
          props.onClick();
        }

        if (!navigator.clipboard) {
          toast({
            title: `Your browser does not support clipboard access, please copy the ${props.label} manually`,
            status: "error",
            duration: 2000,
            isClosable: true,
          });
          return;
        }

        void (async () => {
          await navigator.clipboard.writeText(props.value);
          toast({
            title: `${props.label} copied to your clipboard`,
            status: "success",
            duration: 2000,
            isClosable: true,
          });
        })();
      }}
    >
      <Input
        cursor="pointer"
        type="text"
        value={props.value}
        isReadOnly
        _hover={{
          backgroundColor: "gray.50",
        }}
      />
      <InputRightElement>
        <Copy />
      </InputRightElement>
    </InputGroup>
  );
}
