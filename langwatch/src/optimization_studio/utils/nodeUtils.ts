import type { Node } from "@xyflow/react";
import { camelCaseToSnakeCase } from "../../utils/stringCasing";

export const nameToId = (name: string) => {
  return camelCaseToSnakeCase(name)
    .replace(/[\(\)]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
};

export const findLowestAvailableName = (nodes: Node[], prefix: string) => {
  const findNode = (id: string) => {
    return nodes.find((node) => node.id === id);
  };

  let i = 1;
  let name;
  let id;
  do {
    if (i === 1) {
      name = prefix;
    } else {
      name = `${prefix} (${i})`;
    }
    id = nameToId(name);
    i++;
  } while (findNode(id));

  return { name, id };
};
