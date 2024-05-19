import { Text } from "@chakra-ui/react";
import type { ReactJsonViewProps } from "@microlink/react-json-view";
import dynamic from "next/dynamic";

export function RenderInputOutput(
  props: Partial<ReactJsonViewProps> & { value: string | undefined }
) {
  const { value } = props;
  const ReactJson = dynamic(() => import("@microlink/react-json-view"), {
    loading: () => <div />,
  });

  let json: object | undefined;
  try {
    if (value) {
      const json_ = JSON.parse(value);
      if (typeof json_ === "object") {
        json = json_;
      }
    }
  } catch (e) {}

  const propsWithoutValue = { ...props };
  delete propsWithoutValue.value;

  return typeof document !== "undefined" && json ? (
    <ReactJson
      src={json}
      name={false}
      displayDataTypes={false}
      displayObjectSize={false}
      enableClipboard={false}
      collapseStringsAfterLength={500}
      //@ts-ignore
      displayArrayKey={false}
      {...propsWithoutValue}
    />
  ) : (
    <Text>{value ?? ""}</Text>
  );
}
