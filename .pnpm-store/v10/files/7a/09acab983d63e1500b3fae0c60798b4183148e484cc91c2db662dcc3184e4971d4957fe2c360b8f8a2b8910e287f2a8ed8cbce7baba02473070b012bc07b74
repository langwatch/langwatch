import { collectBody } from "@smithy/core/protocols";
import { toUtf8 } from "@smithy/core/serde";
export const collectBodyString = (streamBody, context) => collectBody(streamBody, context).then((body) => (context?.utf8Encoder ?? toUtf8)(body));
