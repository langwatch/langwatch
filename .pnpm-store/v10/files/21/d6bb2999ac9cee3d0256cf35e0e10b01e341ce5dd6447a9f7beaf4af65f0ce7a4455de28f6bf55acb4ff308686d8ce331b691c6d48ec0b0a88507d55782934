import { z } from 'zod';
/**
 * Every item in the protocol provides a `providerData` field to accommodate custom functionality
 * or new fields
 */
export declare const SharedBase: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    providerData?: Record<string, any> | undefined;
}, {
    providerData?: Record<string, any> | undefined;
}>;
export type SharedBase = z.infer<typeof SharedBase>;
/**
 * Every item has a shared of shared item data including an optional ID.
 */
export declare const ItemBase: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type ItemBase = z.infer<typeof ItemBase>;
export declare const Refusal: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"refusal">;
    /**
     * The refusal explanation from the model.
     */
    refusal: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "refusal";
    refusal: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "refusal";
    refusal: string;
    providerData?: Record<string, any> | undefined;
}>;
export type Refusal = z.infer<typeof Refusal>;
export declare const OutputText: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"output_text">;
    /**
     * The text output from the model.
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "output_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "output_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>;
export type OutputText = z.infer<typeof OutputText>;
export declare const InputText: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_text">;
    /**
     * A text input for example a message from a user
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "input_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "input_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>;
export type InputText = z.infer<typeof InputText>;
export declare const ReasoningText: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"reasoning_text">;
    /**
     * A text input for example a message from a user
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "reasoning_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "reasoning_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>;
export type ReasoningText = z.infer<typeof ReasoningText>;
export declare const InputImage: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_image">;
    /**
     * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
     * previously uploaded OpenAI file.
     */
    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>>;
    /**
     * Controls the level of detail requested for image understanding tasks.
     * Future models may add new values, therefore this accepts any string.
     */
    detail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "input_image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        id: string;
    } | undefined;
    detail?: string | undefined;
}, {
    type: "input_image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        id: string;
    } | undefined;
    detail?: string | undefined;
}>;
export type InputImage = z.infer<typeof InputImage>;
export declare const InputFile: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_file">;
    /**
     * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
     * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
     */
    file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>, z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>]>>;
    /**
     * Optional filename metadata when uploading file data inline.
     */
    filename: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "input_file";
    providerData?: Record<string, any> | undefined;
    file?: string | {
        id: string;
    } | {
        url: string;
    } | undefined;
    filename?: string | undefined;
}, {
    type: "input_file";
    providerData?: Record<string, any> | undefined;
    file?: string | {
        id: string;
    } | {
        url: string;
    } | undefined;
    filename?: string | undefined;
}>;
export type InputFile = z.infer<typeof InputFile>;
export declare const AudioContent: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"audio">;
    /**
     * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
     */
    audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>;
    /**
     * The format of the audio.
     */
    format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /**
     * The transcript of the audio.
     */
    transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "audio";
    audio: string | {
        id: string;
    };
    providerData?: Record<string, any> | undefined;
    format?: string | null | undefined;
    transcript?: string | null | undefined;
}, {
    type: "audio";
    audio: string | {
        id: string;
    };
    providerData?: Record<string, any> | undefined;
    format?: string | null | undefined;
    transcript?: string | null | undefined;
}>;
export type AudioContent = z.infer<typeof AudioContent>;
export declare const ImageContent: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"image">;
    /**
     * The image input to the model. Could be base64 encoded image data or an object with a file ID.
     */
    image: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "image";
    image: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "image";
    image: string;
    providerData?: Record<string, any> | undefined;
}>;
export type ImageContent = z.infer<typeof ImageContent>;
export declare const ToolOutputText: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"text">;
    /**
     * The text output from the model.
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>;
export type ToolOutputText = z.infer<typeof ToolOutputText>;
export declare const ToolOutputImage: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"image">;
    /**
     * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
     * object describing the data/url/fileId source.
     */
    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
        mediaType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    }, {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    }>, z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>, z.ZodObject<{
        fileId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        fileId: string;
    }, {
        fileId: string;
    }>]>]>>;
    /**
     * Controls the requested level of detail for vision models.
     * Use a string to avoid constraining future model capabilities.
     */
    detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
}, "strip", z.ZodTypeAny, {
    type: "image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    } | {
        url: string;
    } | {
        fileId: string;
    } | undefined;
    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
}, {
    type: "image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    } | {
        url: string;
    } | {
        fileId: string;
    } | undefined;
    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
}>;
export type ToolOutputImage = z.infer<typeof ToolOutputImage>;
export declare const ToolOutputFileContent: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"file">;
    /**
     * File output reference. Provide either a string (data URL / base64), a data object (requires
     * mediaType + filename), or an object pointing to an uploaded file/URL.
     */
    file: z.ZodUnion<[z.ZodString, z.ZodObject<{
        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
        mediaType: z.ZodString;
        filename: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    }, {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    }>, z.ZodObject<{
        url: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        filename?: string | undefined;
    }, {
        url: string;
        filename?: string | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        filename?: string | undefined;
    }, {
        id: string;
        filename?: string | undefined;
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "file";
    file: string | {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    } | {
        url: string;
        filename?: string | undefined;
    } | {
        id: string;
        filename?: string | undefined;
    };
    providerData?: Record<string, any> | undefined;
}, {
    type: "file";
    file: string | {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    } | {
        url: string;
        filename?: string | undefined;
    } | {
        id: string;
        filename?: string | undefined;
    };
    providerData?: Record<string, any> | undefined;
}>;
export type ToolOutputFileContent = z.infer<typeof ToolOutputFileContent>;
export declare const ComputerToolOutput: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"computer_screenshot">;
    /**
     * A base64 encoded image data or a URL representing the screenshot.
     */
    data: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "computer_screenshot";
    data: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "computer_screenshot";
    data: string;
    providerData?: Record<string, any> | undefined;
}>;
export type ComputerToolOutput = z.infer<typeof ComputerToolOutput>;
export declare const computerActions: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"screenshot">;
}, "strip", z.ZodTypeAny, {
    type: "screenshot";
}, {
    type: "screenshot";
}>, z.ZodObject<{
    type: z.ZodLiteral<"click">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
}, "strip", z.ZodTypeAny, {
    type: "click";
    x: number;
    y: number;
    button: "left" | "right" | "wheel" | "back" | "forward";
}, {
    type: "click";
    x: number;
    y: number;
    button: "left" | "right" | "wheel" | "back" | "forward";
}>, z.ZodObject<{
    type: z.ZodLiteral<"double_click">;
    x: z.ZodNumber;
    y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "double_click";
    x: number;
    y: number;
}, {
    type: "double_click";
    x: number;
    y: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"scroll">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    scroll_x: z.ZodNumber;
    scroll_y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "scroll";
    x: number;
    y: number;
    scroll_x: number;
    scroll_y: number;
}, {
    type: "scroll";
    x: number;
    y: number;
    scroll_x: number;
    scroll_y: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"type">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "type";
    text: string;
}, {
    type: "type";
    text: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"wait">;
}, "strip", z.ZodTypeAny, {
    type: "wait";
}, {
    type: "wait";
}>, z.ZodObject<{
    type: z.ZodLiteral<"move">;
    x: z.ZodNumber;
    y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: "move";
    x: number;
    y: number;
}, {
    type: "move";
    x: number;
    y: number;
}>, z.ZodObject<{
    type: z.ZodLiteral<"keypress">;
    keys: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    keys: string[];
    type: "keypress";
}, {
    keys: string[];
    type: "keypress";
}>, z.ZodObject<{
    type: z.ZodLiteral<"drag">;
    path: z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    path: {
        x: number;
        y: number;
    }[];
    type: "drag";
}, {
    path: {
        x: number;
        y: number;
    }[];
    type: "drag";
}>]>;
export type ComputerAction = z.infer<typeof computerActions>;
export declare const AssistantContent: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"output_text">;
    /**
     * The text output from the model.
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "output_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "output_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"refusal">;
    /**
     * The refusal explanation from the model.
     */
    refusal: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "refusal";
    refusal: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "refusal";
    refusal: string;
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"audio">;
    /**
     * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
     */
    audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>;
    /**
     * The format of the audio.
     */
    format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /**
     * The transcript of the audio.
     */
    transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "audio";
    audio: string | {
        id: string;
    };
    providerData?: Record<string, any> | undefined;
    format?: string | null | undefined;
    transcript?: string | null | undefined;
}, {
    type: "audio";
    audio: string | {
        id: string;
    };
    providerData?: Record<string, any> | undefined;
    format?: string | null | undefined;
    transcript?: string | null | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"image">;
    /**
     * The image input to the model. Could be base64 encoded image data or an object with a file ID.
     */
    image: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "image";
    image: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "image";
    image: string;
    providerData?: Record<string, any> | undefined;
}>]>;
export type AssistantContent = z.infer<typeof AssistantContent>;
export declare const AssistantMessageItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the assistant (i.e. the model)
     */
    role: z.ZodLiteral<"assistant">;
    /**
     * The status of the message.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The content of the message.
     */
    content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"output_text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"refusal">;
        /**
         * The refusal explanation from the model.
         */
        refusal: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * The image input to the model. Could be base64 encoded image data or an object with a file ID.
         */
        image: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type AssistantMessageItem = z.infer<typeof AssistantMessageItem>;
export declare const UserContent: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_text">;
    /**
     * A text input for example a message from a user
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "input_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "input_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_image">;
    /**
     * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
     * previously uploaded OpenAI file.
     */
    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>>;
    /**
     * Controls the level of detail requested for image understanding tasks.
     * Future models may add new values, therefore this accepts any string.
     */
    detail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "input_image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        id: string;
    } | undefined;
    detail?: string | undefined;
}, {
    type: "input_image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        id: string;
    } | undefined;
    detail?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_file">;
    /**
     * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
     * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
     */
    file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>, z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>]>>;
    /**
     * Optional filename metadata when uploading file data inline.
     */
    filename: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "input_file";
    providerData?: Record<string, any> | undefined;
    file?: string | {
        id: string;
    } | {
        url: string;
    } | undefined;
    filename?: string | undefined;
}, {
    type: "input_file";
    providerData?: Record<string, any> | undefined;
    file?: string | {
        id: string;
    } | {
        url: string;
    } | undefined;
    filename?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"audio">;
    /**
     * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
     */
    audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>;
    /**
     * The format of the audio.
     */
    format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    /**
     * The transcript of the audio.
     */
    transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "audio";
    audio: string | {
        id: string;
    };
    providerData?: Record<string, any> | undefined;
    format?: string | null | undefined;
    transcript?: string | null | undefined;
}, {
    type: "audio";
    audio: string | {
        id: string;
    };
    providerData?: Record<string, any> | undefined;
    format?: string | null | undefined;
    transcript?: string | null | undefined;
}>]>;
export type UserContent = z.infer<typeof UserContent>;
export declare const UserMessageItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the user
     */
    role: z.ZodLiteral<"user">;
    /**
     * The content of the message.
     */
    content: z.ZodUnion<[z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_image">;
        /**
         * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
         * previously uploaded OpenAI file.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>>;
        /**
         * Controls the level of detail requested for image understanding tasks.
         * Future models may add new values, therefore this accepts any string.
         */
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_file">;
        /**
         * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
         * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
         */
        file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>]>>;
        /**
         * Optional filename metadata when uploading file data inline.
         */
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>]>, "many">, z.ZodString]>;
}, "strip", z.ZodTypeAny, {
    role: "user";
    content: string | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    role: "user";
    content: string | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type UserMessageItem = z.infer<typeof UserMessageItem>;
declare const SystemMessageItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a system message to the user
     */
    role: z.ZodLiteral<"system">;
    /**
     * The content of the message.
     */
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "system";
    content: string;
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    role: "system";
    content: string;
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type SystemMessageItem = z.infer<typeof SystemMessageItem>;
export declare const MessageItem: z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a system message to the user
     */
    role: z.ZodLiteral<"system">;
    /**
     * The content of the message.
     */
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "system";
    content: string;
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    role: "system";
    content: string;
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the assistant (i.e. the model)
     */
    role: z.ZodLiteral<"assistant">;
    /**
     * The status of the message.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The content of the message.
     */
    content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"output_text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"refusal">;
        /**
         * The refusal explanation from the model.
         */
        refusal: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * The image input to the model. Could be base64 encoded image data or an object with a file ID.
         */
        image: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the user
     */
    role: z.ZodLiteral<"user">;
    /**
     * The content of the message.
     */
    content: z.ZodUnion<[z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_image">;
        /**
         * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
         * previously uploaded OpenAI file.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>>;
        /**
         * Controls the level of detail requested for image understanding tasks.
         * Future models may add new values, therefore this accepts any string.
         */
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_file">;
        /**
         * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
         * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
         */
        file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>]>>;
        /**
         * Optional filename metadata when uploading file data inline.
         */
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>]>, "many">, z.ZodString]>;
}, "strip", z.ZodTypeAny, {
    role: "user";
    content: string | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    role: "user";
    content: string | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>]>;
export type MessageItem = z.infer<typeof MessageItem>;
export declare const HostedToolCallItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"hosted_tool_call">;
    /**
     * The name of the hosted tool. For example `web_search_call` or `file_search_call`
     */
    name: z.ZodString;
    /**
     * The arguments of the hosted tool call.
     */
    arguments: z.ZodOptional<z.ZodString>;
    /**
     * The status of the tool call.
     */
    status: z.ZodOptional<z.ZodString>;
    /**
     * The primary output of the tool call. Additional output might be in the `providerData` field.
     */
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}>;
export type HostedToolCallItem = z.infer<typeof HostedToolCallItem>;
export declare const FunctionCallItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call">;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The name of the function.
     */
    name: z.ZodString;
    /**
     * The status of the function call.
     */
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    /**
     * The arguments of the function call.
     */
    arguments: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type FunctionCallItem = z.infer<typeof FunctionCallItem>;
export declare const ToolCallOutputContent: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"text">;
    /**
     * The text output from the model.
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"image">;
    /**
     * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
     * object describing the data/url/fileId source.
     */
    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
        mediaType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    }, {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    }>, z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>, z.ZodObject<{
        fileId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        fileId: string;
    }, {
        fileId: string;
    }>]>]>>;
    /**
     * Controls the requested level of detail for vision models.
     * Use a string to avoid constraining future model capabilities.
     */
    detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
}, "strip", z.ZodTypeAny, {
    type: "image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    } | {
        url: string;
    } | {
        fileId: string;
    } | undefined;
    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
}, {
    type: "image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        data: string | Uint8Array<ArrayBuffer>;
        mediaType?: string | undefined;
    } | {
        url: string;
    } | {
        fileId: string;
    } | undefined;
    detail?: "low" | "high" | "auto" | (string & {}) | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"file">;
    /**
     * File output reference. Provide either a string (data URL / base64), a data object (requires
     * mediaType + filename), or an object pointing to an uploaded file/URL.
     */
    file: z.ZodUnion<[z.ZodString, z.ZodObject<{
        data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
        mediaType: z.ZodString;
        filename: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    }, {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    }>, z.ZodObject<{
        url: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        filename?: string | undefined;
    }, {
        url: string;
        filename?: string | undefined;
    }>, z.ZodObject<{
        id: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        filename?: string | undefined;
    }, {
        id: string;
        filename?: string | undefined;
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "file";
    file: string | {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    } | {
        url: string;
        filename?: string | undefined;
    } | {
        id: string;
        filename?: string | undefined;
    };
    providerData?: Record<string, any> | undefined;
}, {
    type: "file";
    file: string | {
        filename: string;
        data: string | Uint8Array<ArrayBuffer>;
        mediaType: string;
    } | {
        url: string;
        filename?: string | undefined;
    } | {
        id: string;
        filename?: string | undefined;
    };
    providerData?: Record<string, any> | undefined;
}>]>;
export type ToolCallOutputContent = z.infer<typeof ToolCallOutputContent>;
export declare const ToolCallStructuredOutput: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_text">;
    /**
     * A text input for example a message from a user
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "input_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "input_text";
    text: string;
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_image">;
    /**
     * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
     * previously uploaded OpenAI file.
     */
    image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>>;
    /**
     * Controls the level of detail requested for image understanding tasks.
     * Future models may add new values, therefore this accepts any string.
     */
    detail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "input_image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        id: string;
    } | undefined;
    detail?: string | undefined;
}, {
    type: "input_image";
    providerData?: Record<string, any> | undefined;
    image?: string | {
        id: string;
    } | undefined;
    detail?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"input_file">;
    /**
     * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
     * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
     */
    file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
        id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>]>, z.ZodObject<{
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
    }, {
        url: string;
    }>]>>;
    /**
     * Optional filename metadata when uploading file data inline.
     */
    filename: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "input_file";
    providerData?: Record<string, any> | undefined;
    file?: string | {
        id: string;
    } | {
        url: string;
    } | undefined;
    filename?: string | undefined;
}, {
    type: "input_file";
    providerData?: Record<string, any> | undefined;
    file?: string | {
        id: string;
    } | {
        url: string;
    } | undefined;
    filename?: string | undefined;
}>]>;
export type ToolCallStructuredOutput = z.infer<typeof ToolCallStructuredOutput>;
export declare const FunctionCallResultItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call_result">;
    /**
     * The name of the tool that was called
     */
    name: z.ZodString;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The status of the tool call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The output of the tool call.
     */
    output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
         * object describing the data/url/fileId source.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
            data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
            mediaType: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        }, {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        }>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>, z.ZodObject<{
            fileId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            fileId: string;
        }, {
            fileId: string;
        }>]>]>>;
        /**
         * Controls the requested level of detail for vision models.
         * Use a string to avoid constraining future model capabilities.
         */
        detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    }, {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"file">;
        /**
         * File output reference. Provide either a string (data URL / base64), a data object (requires
         * mediaType + filename), or an object pointing to an uploaded file/URL.
         */
        file: z.ZodUnion<[z.ZodString, z.ZodObject<{
            data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
            mediaType: z.ZodString;
            filename: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        }, {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        }>, z.ZodObject<{
            url: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            filename?: string | undefined;
        }, {
            url: string;
            filename?: string | undefined;
        }>, z.ZodObject<{
            id: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            filename?: string | undefined;
        }, {
            id: string;
            filename?: string | undefined;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }, {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_image">;
        /**
         * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
         * previously uploaded OpenAI file.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>>;
        /**
         * Controls the level of detail requested for image understanding tasks.
         * Future models may add new values, therefore this accepts any string.
         */
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_file">;
        /**
         * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
         * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
         */
        file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>]>>;
        /**
         * Optional filename metadata when uploading file data inline.
         */
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }>]>, "many">]>;
}, "strip", z.ZodTypeAny, {
    type: "function_call_result";
    status: "in_progress" | "completed" | "incomplete";
    name: string;
    output: string | {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    } | {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    } | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    })[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call_result";
    status: "in_progress" | "completed" | "incomplete";
    name: string;
    output: string | {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    } | {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    } | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    })[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type FunctionCallResultItem = z.infer<typeof FunctionCallResultItem>;
export declare const ComputerUseCallItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"computer_call">;
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: z.ZodString;
    /**
     * The status of the computer call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The action to be performed by the computer.
     */
    action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"screenshot">;
    }, "strip", z.ZodTypeAny, {
        type: "screenshot";
    }, {
        type: "screenshot";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
    }, "strip", z.ZodTypeAny, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"double_click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "double_click";
        x: number;
        y: number;
    }, {
        type: "double_click";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"scroll">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        scroll_x: z.ZodNumber;
        scroll_y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"type">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "type";
        text: string;
    }, {
        type: "type";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"wait">;
    }, "strip", z.ZodTypeAny, {
        type: "wait";
    }, {
        type: "wait";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"move">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "move";
        x: number;
        y: number;
    }, {
        type: "move";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"keypress">;
        keys: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        keys: string[];
        type: "keypress";
    }, {
        keys: string[];
        type: "keypress";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"drag">;
        path: z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type ComputerUseCallItem = z.infer<typeof ComputerUseCallItem>;
export declare const ComputerCallResultItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"computer_call_result">;
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: z.ZodString;
    /**
     * The output of the computer call.
     */
    output: z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"computer_screenshot">;
        /**
         * A base64 encoded image data or a URL representing the screenshot.
         */
        data: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "computer_call_result";
    output: {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    };
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "computer_call_result";
    output: {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    };
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type ComputerCallResultItem = z.infer<typeof ComputerCallResultItem>;
export declare const ShellAction: z.ZodObject<{
    commands: z.ZodArray<z.ZodString, "many">;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    maxOutputLength: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    commands: string[];
    timeoutMs?: number | undefined;
    maxOutputLength?: number | undefined;
}, {
    commands: string[];
    timeoutMs?: number | undefined;
    maxOutputLength?: number | undefined;
}>;
export type ShellAction = z.infer<typeof ShellAction>;
export declare const ShellCallItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call">;
    callId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    action: z.ZodObject<{
        commands: z.ZodArray<z.ZodString, "many">;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        maxOutputLength: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type ShellCallItem = z.infer<typeof ShellCallItem>;
export declare const ShellCallOutcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"timeout">;
}, "strip", z.ZodTypeAny, {
    type: "timeout";
}, {
    type: "timeout";
}>, z.ZodObject<{
    type: z.ZodLiteral<"exit">;
    exitCode: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "exit";
    exitCode: number | null;
}, {
    type: "exit";
    exitCode: number | null;
}>]>;
export type ShellCallOutcome = z.infer<typeof ShellCallOutcome>;
export declare const ShellCallOutputContent: z.ZodObject<{
    stdout: z.ZodString;
    stderr: z.ZodString;
    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"timeout">;
    }, "strip", z.ZodTypeAny, {
        type: "timeout";
    }, {
        type: "timeout";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"exit">;
        exitCode: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "exit";
        exitCode: number | null;
    }, {
        type: "exit";
        exitCode: number | null;
    }>]>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    stdout: z.ZodString;
    stderr: z.ZodString;
    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"timeout">;
    }, "strip", z.ZodTypeAny, {
        type: "timeout";
    }, {
        type: "timeout";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"exit">;
        exitCode: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "exit";
        exitCode: number | null;
    }, {
        type: "exit";
        exitCode: number | null;
    }>]>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    stdout: z.ZodString;
    stderr: z.ZodString;
    outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"timeout">;
    }, "strip", z.ZodTypeAny, {
        type: "timeout";
    }, {
        type: "timeout";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"exit">;
        exitCode: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "exit";
        exitCode: number | null;
    }, {
        type: "exit";
        exitCode: number | null;
    }>]>;
}, z.ZodTypeAny, "passthrough">>;
export type ShellCallOutputContent = z.infer<typeof ShellCallOutputContent>;
export declare const ShellCallResultItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call_output">;
    callId: z.ZodString;
    maxOutputLength: z.ZodOptional<z.ZodNumber>;
    output: z.ZodArray<z.ZodObject<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "shell_call_output";
    output: z.objectOutputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    maxOutputLength?: number | undefined;
}, {
    type: "shell_call_output";
    output: z.objectInputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    maxOutputLength?: number | undefined;
}>;
export type ShellCallResultItem = z.infer<typeof ShellCallResultItem>;
export declare const ApplyPatchOperationCreateFile: z.ZodObject<{
    type: z.ZodLiteral<"create_file">;
    path: z.ZodString;
    diff: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "create_file";
    diff: string;
}, {
    path: string;
    type: "create_file";
    diff: string;
}>;
export type ApplyPatchOperationCreateFile = z.infer<typeof ApplyPatchOperationCreateFile>;
export declare const ApplyPatchOperationUpdateFile: z.ZodObject<{
    type: z.ZodLiteral<"update_file">;
    path: z.ZodString;
    diff: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "update_file";
    diff: string;
}, {
    path: string;
    type: "update_file";
    diff: string;
}>;
export type ApplyPatchOperationUpdateFile = z.infer<typeof ApplyPatchOperationUpdateFile>;
export declare const ApplyPatchOperationDeleteFile: z.ZodObject<{
    type: z.ZodLiteral<"delete_file">;
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "delete_file";
}, {
    path: string;
    type: "delete_file";
}>;
export type ApplyPatchOperationDeleteFile = z.infer<typeof ApplyPatchOperationDeleteFile>;
export declare const ApplyPatchOperation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"create_file">;
    path: z.ZodString;
    diff: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "create_file";
    diff: string;
}, {
    path: string;
    type: "create_file";
    diff: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"update_file">;
    path: z.ZodString;
    diff: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "update_file";
    diff: string;
}, {
    path: string;
    type: "update_file";
    diff: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"delete_file">;
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    type: "delete_file";
}, {
    path: string;
    type: "delete_file";
}>]>;
export type ApplyPatchOperation = z.infer<typeof ApplyPatchOperation>;
export declare const ApplyPatchCallItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call">;
    callId: z.ZodString;
    status: z.ZodEnum<["in_progress", "completed"]>;
    operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"create_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "create_file";
        diff: string;
    }, {
        path: string;
        type: "create_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"update_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "update_file";
        diff: string;
    }, {
        path: string;
        type: "update_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"delete_file">;
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "delete_file";
    }, {
        path: string;
        type: "delete_file";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type ApplyPatchCallItem = z.infer<typeof ApplyPatchCallItem>;
export declare const ApplyPatchCallResultItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call_output">;
    callId: z.ZodString;
    status: z.ZodEnum<["completed", "failed"]>;
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call_output";
    status: "completed" | "failed";
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    output?: string | undefined;
}, {
    type: "apply_patch_call_output";
    status: "completed" | "failed";
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    output?: string | undefined;
}>;
export type ApplyPatchCallResultItem = z.infer<typeof ApplyPatchCallResultItem>;
export declare const ToolCallItem: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"computer_call">;
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: z.ZodString;
    /**
     * The status of the computer call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The action to be performed by the computer.
     */
    action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"screenshot">;
    }, "strip", z.ZodTypeAny, {
        type: "screenshot";
    }, {
        type: "screenshot";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
    }, "strip", z.ZodTypeAny, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"double_click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "double_click";
        x: number;
        y: number;
    }, {
        type: "double_click";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"scroll">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        scroll_x: z.ZodNumber;
        scroll_y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"type">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "type";
        text: string;
    }, {
        type: "type";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"wait">;
    }, "strip", z.ZodTypeAny, {
        type: "wait";
    }, {
        type: "wait";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"move">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "move";
        x: number;
        y: number;
    }, {
        type: "move";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"keypress">;
        keys: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        keys: string[];
        type: "keypress";
    }, {
        keys: string[];
        type: "keypress";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"drag">;
        path: z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call">;
    callId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    action: z.ZodObject<{
        commands: z.ZodArray<z.ZodString, "many">;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        maxOutputLength: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call">;
    callId: z.ZodString;
    status: z.ZodEnum<["in_progress", "completed"]>;
    operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"create_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "create_file";
        diff: string;
    }, {
        path: string;
        type: "create_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"update_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "update_file";
        diff: string;
    }, {
        path: string;
        type: "update_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"delete_file">;
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "delete_file";
    }, {
        path: string;
        type: "delete_file";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call">;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The name of the function.
     */
    name: z.ZodString;
    /**
     * The status of the function call.
     */
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    /**
     * The arguments of the function call.
     */
    arguments: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"hosted_tool_call">;
    /**
     * The name of the hosted tool. For example `web_search_call` or `file_search_call`
     */
    name: z.ZodString;
    /**
     * The arguments of the hosted tool call.
     */
    arguments: z.ZodOptional<z.ZodString>;
    /**
     * The status of the tool call.
     */
    status: z.ZodOptional<z.ZodString>;
    /**
     * The primary output of the tool call. Additional output might be in the `providerData` field.
     */
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}>]>;
export type ToolCallItem = z.infer<typeof ToolCallItem>;
export declare const ReasoningItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reasoning">;
    /**
     * The user facing representation of the reasoning. Additional information might be in the `providerData` field.
     */
    content: z.ZodArray<z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, "many">;
    /**
     * The raw reasoning text from the model.
     */
    rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"reasoning_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "reasoning";
    content: {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[];
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    rawContent?: {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[] | undefined;
}, {
    type: "reasoning";
    content: {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[];
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    rawContent?: {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[] | undefined;
}>;
export type ReasoningItem = z.infer<typeof ReasoningItem>;
export declare const CompactionItem: z.ZodObject<{
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"compaction">;
    encrypted_content: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
    created_by: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "compaction";
    encrypted_content: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    created_by?: string | undefined;
}, {
    type: "compaction";
    encrypted_content: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    created_by?: string | undefined;
}>;
export type CompactionItem = z.infer<typeof CompactionItem>;
/**
 * This is a catch all for items that are not part of the protocol.
 *
 * For example, a model might return an item that is not part of the protocol using this type.
 *
 * In that case everything returned from the model should be passed in the `providerData` field.
 *
 * This enables new features to be added to be added by a model provider without breaking the protocol.
 */
export declare const UnknownItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"unknown">;
}, "strip", z.ZodTypeAny, {
    type: "unknown";
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "unknown";
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>;
export type UnknownItem = z.infer<typeof UnknownItem>;
export declare const OutputModelItem: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the assistant (i.e. the model)
     */
    role: z.ZodLiteral<"assistant">;
    /**
     * The status of the message.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The content of the message.
     */
    content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"output_text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"refusal">;
        /**
         * The refusal explanation from the model.
         */
        refusal: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * The image input to the model. Could be base64 encoded image data or an object with a file ID.
         */
        image: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"hosted_tool_call">;
    /**
     * The name of the hosted tool. For example `web_search_call` or `file_search_call`
     */
    name: z.ZodString;
    /**
     * The arguments of the hosted tool call.
     */
    arguments: z.ZodOptional<z.ZodString>;
    /**
     * The status of the tool call.
     */
    status: z.ZodOptional<z.ZodString>;
    /**
     * The primary output of the tool call. Additional output might be in the `providerData` field.
     */
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call">;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The name of the function.
     */
    name: z.ZodString;
    /**
     * The status of the function call.
     */
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    /**
     * The arguments of the function call.
     */
    arguments: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"computer_call">;
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: z.ZodString;
    /**
     * The status of the computer call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The action to be performed by the computer.
     */
    action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"screenshot">;
    }, "strip", z.ZodTypeAny, {
        type: "screenshot";
    }, {
        type: "screenshot";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
    }, "strip", z.ZodTypeAny, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"double_click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "double_click";
        x: number;
        y: number;
    }, {
        type: "double_click";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"scroll">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        scroll_x: z.ZodNumber;
        scroll_y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"type">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "type";
        text: string;
    }, {
        type: "type";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"wait">;
    }, "strip", z.ZodTypeAny, {
        type: "wait";
    }, {
        type: "wait";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"move">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "move";
        x: number;
        y: number;
    }, {
        type: "move";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"keypress">;
        keys: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        keys: string[];
        type: "keypress";
    }, {
        keys: string[];
        type: "keypress";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"drag">;
        path: z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call">;
    callId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    action: z.ZodObject<{
        commands: z.ZodArray<z.ZodString, "many">;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        maxOutputLength: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call">;
    callId: z.ZodString;
    status: z.ZodEnum<["in_progress", "completed"]>;
    operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"create_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "create_file";
        diff: string;
    }, {
        path: string;
        type: "create_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"update_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "update_file";
        diff: string;
    }, {
        path: string;
        type: "update_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"delete_file">;
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "delete_file";
    }, {
        path: string;
        type: "delete_file";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call_result">;
    /**
     * The name of the tool that was called
     */
    name: z.ZodString;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The status of the tool call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The output of the tool call.
     */
    output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
         * object describing the data/url/fileId source.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
            data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
            mediaType: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        }, {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        }>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>, z.ZodObject<{
            fileId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            fileId: string;
        }, {
            fileId: string;
        }>]>]>>;
        /**
         * Controls the requested level of detail for vision models.
         * Use a string to avoid constraining future model capabilities.
         */
        detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    }, {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"file">;
        /**
         * File output reference. Provide either a string (data URL / base64), a data object (requires
         * mediaType + filename), or an object pointing to an uploaded file/URL.
         */
        file: z.ZodUnion<[z.ZodString, z.ZodObject<{
            data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
            mediaType: z.ZodString;
            filename: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        }, {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        }>, z.ZodObject<{
            url: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            filename?: string | undefined;
        }, {
            url: string;
            filename?: string | undefined;
        }>, z.ZodObject<{
            id: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            filename?: string | undefined;
        }, {
            id: string;
            filename?: string | undefined;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }, {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_image">;
        /**
         * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
         * previously uploaded OpenAI file.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>>;
        /**
         * Controls the level of detail requested for image understanding tasks.
         * Future models may add new values, therefore this accepts any string.
         */
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_file">;
        /**
         * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
         * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
         */
        file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>]>>;
        /**
         * Optional filename metadata when uploading file data inline.
         */
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }>]>, "many">]>;
}, "strip", z.ZodTypeAny, {
    type: "function_call_result";
    status: "in_progress" | "completed" | "incomplete";
    name: string;
    output: string | {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    } | {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    } | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    })[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call_result";
    status: "in_progress" | "completed" | "incomplete";
    name: string;
    output: string | {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    } | {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    } | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    })[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call_output">;
    callId: z.ZodString;
    maxOutputLength: z.ZodOptional<z.ZodNumber>;
    output: z.ZodArray<z.ZodObject<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "shell_call_output";
    output: z.objectOutputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    maxOutputLength?: number | undefined;
}, {
    type: "shell_call_output";
    output: z.objectInputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    maxOutputLength?: number | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call_output">;
    callId: z.ZodString;
    status: z.ZodEnum<["completed", "failed"]>;
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call_output";
    status: "completed" | "failed";
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    output?: string | undefined;
}, {
    type: "apply_patch_call_output";
    status: "completed" | "failed";
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    output?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reasoning">;
    /**
     * The user facing representation of the reasoning. Additional information might be in the `providerData` field.
     */
    content: z.ZodArray<z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, "many">;
    /**
     * The raw reasoning text from the model.
     */
    rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"reasoning_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "reasoning";
    content: {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[];
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    rawContent?: {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[] | undefined;
}, {
    type: "reasoning";
    content: {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[];
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    rawContent?: {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[] | undefined;
}>, z.ZodObject<{
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"compaction">;
    encrypted_content: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
    created_by: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "compaction";
    encrypted_content: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    created_by?: string | undefined;
}, {
    type: "compaction";
    encrypted_content: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    created_by?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"unknown">;
}, "strip", z.ZodTypeAny, {
    type: "unknown";
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "unknown";
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>]>;
export type OutputModelItem = z.infer<typeof OutputModelItem>;
export declare const ModelItem: z.ZodUnion<[z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the user
     */
    role: z.ZodLiteral<"user">;
    /**
     * The content of the message.
     */
    content: z.ZodUnion<[z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_image">;
        /**
         * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
         * previously uploaded OpenAI file.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>>;
        /**
         * Controls the level of detail requested for image understanding tasks.
         * Future models may add new values, therefore this accepts any string.
         */
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_file">;
        /**
         * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
         * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
         */
        file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>]>>;
        /**
         * Optional filename metadata when uploading file data inline.
         */
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>]>, "many">, z.ZodString]>;
}, "strip", z.ZodTypeAny, {
    role: "user";
    content: string | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    role: "user";
    content: string | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a message from the assistant (i.e. the model)
     */
    role: z.ZodLiteral<"assistant">;
    /**
     * The status of the message.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The content of the message.
     */
    content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"output_text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"refusal">;
        /**
         * The refusal explanation from the model.
         */
        refusal: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"audio">;
        /**
         * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
         */
        audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>;
        /**
         * The format of the audio.
         */
        format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        /**
         * The transcript of the audio.
         */
        transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }, {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * The image input to the model. Could be base64 encoded image data or an object with a file ID.
         */
        image: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    status: "in_progress" | "completed" | "incomplete";
    role: "assistant";
    content: ({
        type: "refusal";
        refusal: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "output_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "audio";
        audio: string | {
            id: string;
        };
        providerData?: Record<string, any> | undefined;
        format?: string | null | undefined;
        transcript?: string | null | undefined;
    } | {
        type: "image";
        image: string;
        providerData?: Record<string, any> | undefined;
    })[];
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    /**
     * Any item without a type is treated as a message
     */
    type: z.ZodOptional<z.ZodLiteral<"message">>;
} & {
    /**
     * Representing a system message to the user
     */
    role: z.ZodLiteral<"system">;
    /**
     * The content of the message.
     */
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "system";
    content: string;
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    role: "system";
    content: string;
    type?: "message" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"hosted_tool_call">;
    /**
     * The name of the hosted tool. For example `web_search_call` or `file_search_call`
     */
    name: z.ZodString;
    /**
     * The arguments of the hosted tool call.
     */
    arguments: z.ZodOptional<z.ZodString>;
    /**
     * The status of the tool call.
     */
    status: z.ZodOptional<z.ZodString>;
    /**
     * The primary output of the tool call. Additional output might be in the `providerData` field.
     */
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}, {
    type: "hosted_tool_call";
    name: string;
    status?: string | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    arguments?: string | undefined;
    output?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call">;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The name of the function.
     */
    name: z.ZodString;
    /**
     * The status of the function call.
     */
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    /**
     * The arguments of the function call.
     */
    arguments: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call";
    name: string;
    arguments: string;
    callId: string;
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"computer_call">;
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: z.ZodString;
    /**
     * The status of the computer call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The action to be performed by the computer.
     */
    action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"screenshot">;
    }, "strip", z.ZodTypeAny, {
        type: "screenshot";
    }, {
        type: "screenshot";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
    }, "strip", z.ZodTypeAny, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }, {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"double_click">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "double_click";
        x: number;
        y: number;
    }, {
        type: "double_click";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"scroll">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        scroll_x: z.ZodNumber;
        scroll_y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }, {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"type">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "type";
        text: string;
    }, {
        type: "type";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"wait">;
    }, "strip", z.ZodTypeAny, {
        type: "wait";
    }, {
        type: "wait";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"move">;
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: "move";
        x: number;
        y: number;
    }, {
        type: "move";
        x: number;
        y: number;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"keypress">;
        keys: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        keys: string[];
        type: "keypress";
    }, {
        keys: string[];
        type: "keypress";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"drag">;
        path: z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }, {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "computer_call";
    status: "in_progress" | "completed" | "incomplete";
    callId: string;
    action: {
        type: "screenshot";
    } | {
        type: "click";
        x: number;
        y: number;
        button: "left" | "right" | "wheel" | "back" | "forward";
    } | {
        type: "double_click";
        x: number;
        y: number;
    } | {
        type: "scroll";
        x: number;
        y: number;
        scroll_x: number;
        scroll_y: number;
    } | {
        type: "type";
        text: string;
    } | {
        type: "wait";
    } | {
        type: "move";
        x: number;
        y: number;
    } | {
        keys: string[];
        type: "keypress";
    } | {
        path: {
            x: number;
            y: number;
        }[];
        type: "drag";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call">;
    callId: z.ZodString;
    status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
    action: z.ZodObject<{
        commands: z.ZodArray<z.ZodString, "many">;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        maxOutputLength: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }, {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "shell_call";
    callId: string;
    action: {
        commands: string[];
        timeoutMs?: number | undefined;
        maxOutputLength?: number | undefined;
    };
    status?: "in_progress" | "completed" | "incomplete" | undefined;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call">;
    callId: z.ZodString;
    status: z.ZodEnum<["in_progress", "completed"]>;
    operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"create_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "create_file";
        diff: string;
    }, {
        path: string;
        type: "create_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"update_file">;
        path: z.ZodString;
        diff: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "update_file";
        diff: string;
    }, {
        path: string;
        type: "update_file";
        diff: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"delete_file">;
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "delete_file";
    }, {
        path: string;
        type: "delete_file";
    }>]>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "apply_patch_call";
    status: "in_progress" | "completed";
    callId: string;
    operation: {
        path: string;
        type: "create_file";
        diff: string;
    } | {
        path: string;
        type: "update_file";
        diff: string;
    } | {
        path: string;
        type: "delete_file";
    };
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"function_call_result">;
    /**
     * The name of the tool that was called
     */
    name: z.ZodString;
    /**
     * The ID of the tool call. Required to match up the respective tool call result.
     */
    callId: z.ZodString;
    /**
     * The status of the tool call.
     */
    status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
    /**
     * The output of the tool call.
     */
    output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"text">;
        /**
         * The text output from the model.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"image">;
        /**
         * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
         * object describing the data/url/fileId source.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
            data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
            mediaType: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        }, {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        }>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>, z.ZodObject<{
            fileId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            fileId: string;
        }, {
            fileId: string;
        }>]>]>>;
        /**
         * Controls the requested level of detail for vision models.
         * Use a string to avoid constraining future model capabilities.
         */
        detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    }, {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"file">;
        /**
         * File output reference. Provide either a string (data URL / base64), a data object (requires
         * mediaType + filename), or an object pointing to an uploaded file/URL.
         */
        file: z.ZodUnion<[z.ZodString, z.ZodObject<{
            data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
            mediaType: z.ZodString;
            filename: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        }, {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        }>, z.ZodObject<{
            url: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            filename?: string | undefined;
        }, {
            url: string;
            filename?: string | undefined;
        }>, z.ZodObject<{
            id: z.ZodString;
            filename: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            filename?: string | undefined;
        }, {
            id: string;
            filename?: string | undefined;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }, {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_image">;
        /**
         * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
         * previously uploaded OpenAI file.
         */
        image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>>;
        /**
         * Controls the level of detail requested for image understanding tasks.
         * Future models may add new values, therefore this accepts any string.
         */
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }, {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    }>, z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_file">;
        /**
         * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
         * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
         */
        file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
            id: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
        }, {
            id: string;
        }>]>, z.ZodObject<{
            url: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>]>>;
        /**
         * Optional filename metadata when uploading file data inline.
         */
        filename: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }, {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    }>]>, "many">]>;
}, "strip", z.ZodTypeAny, {
    type: "function_call_result";
    status: "in_progress" | "completed" | "incomplete";
    name: string;
    output: string | {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    } | {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    } | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    })[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "function_call_result";
    status: "in_progress" | "completed" | "incomplete";
    name: string;
    output: string | {
        type: "text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            data: string | Uint8Array<ArrayBuffer>;
            mediaType?: string | undefined;
        } | {
            url: string;
        } | {
            fileId: string;
        } | undefined;
        detail?: "low" | "high" | "auto" | (string & {}) | undefined;
    } | {
        type: "file";
        file: string | {
            filename: string;
            data: string | Uint8Array<ArrayBuffer>;
            mediaType: string;
        } | {
            url: string;
            filename?: string | undefined;
        } | {
            id: string;
            filename?: string | undefined;
        };
        providerData?: Record<string, any> | undefined;
    } | ({
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    } | {
        type: "input_image";
        providerData?: Record<string, any> | undefined;
        image?: string | {
            id: string;
        } | undefined;
        detail?: string | undefined;
    } | {
        type: "input_file";
        providerData?: Record<string, any> | undefined;
        file?: string | {
            id: string;
        } | {
            url: string;
        } | undefined;
        filename?: string | undefined;
    })[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"computer_call_result">;
    /**
     * The ID of the computer call. Required to match up the respective computer call result.
     */
    callId: z.ZodString;
    /**
     * The output of the computer call.
     */
    output: z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"computer_screenshot">;
        /**
         * A base64 encoded image data or a URL representing the screenshot.
         */
        data: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "computer_call_result";
    output: {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    };
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "computer_call_result";
    output: {
        type: "computer_screenshot";
        data: string;
        providerData?: Record<string, any> | undefined;
    };
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"shell_call_output">;
    callId: z.ZodString;
    maxOutputLength: z.ZodOptional<z.ZodNumber>;
    output: z.ZodArray<z.ZodObject<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "strip", z.ZodTypeAny, {
    type: "shell_call_output";
    output: z.objectOutputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    maxOutputLength?: number | undefined;
}, {
    type: "shell_call_output";
    output: z.objectInputType<{
        stdout: z.ZodString;
        stderr: z.ZodString;
        outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"timeout">;
        }, "strip", z.ZodTypeAny, {
            type: "timeout";
        }, {
            type: "timeout";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"exit">;
            exitCode: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "exit";
            exitCode: number | null;
        }, {
            type: "exit";
            exitCode: number | null;
        }>]>;
    }, z.ZodTypeAny, "passthrough">[];
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    maxOutputLength?: number | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"apply_patch_call_output">;
    callId: z.ZodString;
    status: z.ZodEnum<["completed", "failed"]>;
    output: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "apply_patch_call_output";
    status: "completed" | "failed";
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    output?: string | undefined;
}, {
    type: "apply_patch_call_output";
    status: "completed" | "failed";
    callId: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    output?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    id: z.ZodOptional<z.ZodString>;
    type: z.ZodLiteral<"reasoning">;
    /**
     * The user facing representation of the reasoning. Additional information might be in the `providerData` field.
     */
    content: z.ZodArray<z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"input_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, "many">;
    /**
     * The raw reasoning text from the model.
     */
    rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        type: z.ZodLiteral<"reasoning_text">;
        /**
         * A text input for example a message from a user
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }, {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "reasoning";
    content: {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[];
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    rawContent?: {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[] | undefined;
}, {
    type: "reasoning";
    content: {
        type: "input_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[];
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    rawContent?: {
        type: "reasoning_text";
        text: string;
        providerData?: Record<string, any> | undefined;
    }[] | undefined;
}>, z.ZodObject<{
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"compaction">;
    encrypted_content: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
    created_by: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "compaction";
    encrypted_content: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    created_by?: string | undefined;
}, {
    type: "compaction";
    encrypted_content: string;
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
    created_by?: string | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    /**
     * An ID to identify the item. This is optional by default. If a model provider absolutely
     * requires this field, it will be validated on the model level.
     */
    id: z.ZodOptional<z.ZodString>;
} & {
    type: z.ZodLiteral<"unknown">;
}, "strip", z.ZodTypeAny, {
    type: "unknown";
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}, {
    type: "unknown";
    providerData?: Record<string, any> | undefined;
    id?: string | undefined;
}>]>;
export type ModelItem = z.infer<typeof ModelItem>;
export declare const RequestUsageData: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    totalTokens: z.ZodNumber;
    inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    endpoint: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails?: Record<string, number> | undefined;
    outputTokensDetails?: Record<string, number> | undefined;
    endpoint?: string | undefined;
}, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails?: Record<string, number> | undefined;
    outputTokensDetails?: Record<string, number> | undefined;
    endpoint?: string | undefined;
}>;
export type RequestUsageData = z.infer<typeof RequestUsageData>;
export declare const UsageData: z.ZodObject<{
    requests: z.ZodOptional<z.ZodNumber>;
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    totalTokens: z.ZodNumber;
    inputTokensDetails: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodNumber>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">]>>;
    outputTokensDetails: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodNumber>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">]>>;
    requestUsageEntries: z.ZodOptional<z.ZodArray<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        endpoint: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        inputTokensDetails?: Record<string, number> | undefined;
        outputTokensDetails?: Record<string, number> | undefined;
        endpoint?: string | undefined;
    }, {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        inputTokensDetails?: Record<string, number> | undefined;
        outputTokensDetails?: Record<string, number> | undefined;
        endpoint?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
    outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
    requests?: number | undefined;
    requestUsageEntries?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        inputTokensDetails?: Record<string, number> | undefined;
        outputTokensDetails?: Record<string, number> | undefined;
        endpoint?: string | undefined;
    }[] | undefined;
}, {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
    outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
    requests?: number | undefined;
    requestUsageEntries?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        inputTokensDetails?: Record<string, number> | undefined;
        outputTokensDetails?: Record<string, number> | undefined;
        endpoint?: string | undefined;
    }[] | undefined;
}>;
export type UsageData = z.infer<typeof UsageData>;
/**
 * Event returned by the model when new output text is available to stream to the user.
 */
export declare const StreamEventTextStream: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"output_text_delta">;
    /**
     * The delta text that was streamed by the modelto the user.
     */
    delta: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "output_text_delta";
    delta: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "output_text_delta";
    delta: string;
    providerData?: Record<string, any> | undefined;
}>;
export type StreamEventTextStream = z.infer<typeof StreamEventTextStream>;
/**
 * Event returned by the model when a new response is started.
 */
export declare const StreamEventResponseStarted: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"response_started">;
}, "strip", z.ZodTypeAny, {
    type: "response_started";
    providerData?: Record<string, any> | undefined;
}, {
    type: "response_started";
    providerData?: Record<string, any> | undefined;
}>;
export type StreamEventResponseStarted = z.infer<typeof StreamEventResponseStarted>;
/**
 * Event returned by the model when a response is completed.
 */
export declare const StreamEventResponseCompleted: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"response_done">;
    /**
     * The response from the model.
     */
    response: z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        /**
         * The ID of the response.
         */
        id: z.ZodString;
        /**
         * The usage data for the response.
         */
        usage: z.ZodObject<{
            requests: z.ZodOptional<z.ZodNumber>;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            inputTokensDetails: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodNumber>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">]>>;
            outputTokensDetails: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodNumber>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">]>>;
            requestUsageEntries: z.ZodOptional<z.ZodArray<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                endpoint: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }>;
        /**
         * The output from the model.
         */
        output: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            /**
             * Any item without a type is treated as a message
             */
            type: z.ZodOptional<z.ZodLiteral<"message">>;
        } & {
            /**
             * Representing a message from the assistant (i.e. the model)
             */
            role: z.ZodLiteral<"assistant">;
            /**
             * The status of the message.
             */
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            /**
             * The content of the message.
             */
            content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"output_text">;
                /**
                 * The text output from the model.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"refusal">;
                /**
                 * The refusal explanation from the model.
                 */
                refusal: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"audio">;
                /**
                 * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
                 */
                audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>;
                /**
                 * The format of the audio.
                 */
                format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                /**
                 * The transcript of the audio.
                 */
                transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                /**
                 * The image input to the model. Could be base64 encoded image data or an object with a file ID.
                 */
                image: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }>]>, "many">;
        }, "strip", z.ZodTypeAny, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            /**
             * The name of the hosted tool. For example `web_search_call` or `file_search_call`
             */
            name: z.ZodString;
            /**
             * The arguments of the hosted tool call.
             */
            arguments: z.ZodOptional<z.ZodString>;
            /**
             * The status of the tool call.
             */
            status: z.ZodOptional<z.ZodString>;
            /**
             * The primary output of the tool call. Additional output might be in the `providerData` field.
             */
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            /**
             * The ID of the tool call. Required to match up the respective tool call result.
             */
            callId: z.ZodString;
            /**
             * The name of the function.
             */
            name: z.ZodString;
            /**
             * The status of the function call.
             */
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            /**
             * The arguments of the function call.
             */
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"computer_call">;
            /**
             * The ID of the computer call. Required to match up the respective computer call result.
             */
            callId: z.ZodString;
            /**
             * The status of the computer call.
             */
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            /**
             * The action to be performed by the computer.
             */
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"screenshot">;
            }, "strip", z.ZodTypeAny, {
                type: "screenshot";
            }, {
                type: "screenshot";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
            }, "strip", z.ZodTypeAny, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
            }, {
                type: "double_click";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                scroll_x: z.ZodNumber;
                scroll_y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"type">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "type";
                text: string;
            }, {
                type: "type";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
            }, "strip", z.ZodTypeAny, {
                type: "wait";
            }, {
                type: "wait";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "move";
                x: number;
                y: number;
            }, {
                type: "move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"keypress">;
                keys: z.ZodArray<z.ZodString, "many">;
            }, "strip", z.ZodTypeAny, {
                keys: string[];
                type: "keypress";
            }, {
                keys: string[];
                type: "keypress";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                path: z.ZodArray<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    x: number;
                    y: number;
                }, {
                    x: number;
                    y: number;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call">;
            callId: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            action: z.ZodObject<{
                commands: z.ZodArray<z.ZodString, "many">;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed"]>;
            operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"create_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "create_file";
                diff: string;
            }, {
                path: string;
                type: "create_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"update_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "update_file";
                diff: string;
            }, {
                path: string;
                type: "update_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"delete_file">;
                path: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "delete_file";
            }, {
                path: string;
                type: "delete_file";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call_result">;
            /**
             * The name of the tool that was called
             */
            name: z.ZodString;
            /**
             * The ID of the tool call. Required to match up the respective tool call result.
             */
            callId: z.ZodString;
            /**
             * The status of the tool call.
             */
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            /**
             * The output of the tool call.
             */
            output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"text">;
                /**
                 * The text output from the model.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                /**
                 * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
                 * object describing the data/url/fileId source.
                 */
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>, z.ZodObject<{
                    fileId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    fileId: string;
                }, {
                    fileId: string;
                }>]>]>>;
                /**
                 * Controls the requested level of detail for vision models.
                 * Use a string to avoid constraining future model capabilities.
                 */
                detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"file">;
                /**
                 * File output reference. Provide either a string (data URL / base64), a data object (requires
                 * mediaType + filename), or an object pointing to an uploaded file/URL.
                 */
                file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodString;
                    filename: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }>, z.ZodObject<{
                    url: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    filename?: string | undefined;
                }, {
                    url: string;
                    filename?: string | undefined;
                }>, z.ZodObject<{
                    id: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    filename?: string | undefined;
                }, {
                    id: string;
                    filename?: string | undefined;
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                /**
                 * A text input for example a message from a user
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_image">;
                /**
                 * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
                 * previously uploaded OpenAI file.
                 */
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>>;
                /**
                 * Controls the level of detail requested for image understanding tasks.
                 * Future models may add new values, therefore this accepts any string.
                 */
                detail: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_file">;
                /**
                 * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
                 * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
                 */
                file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>]>>;
                /**
                 * Optional filename metadata when uploading file data inline.
                 */
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }>]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call_output">;
            callId: z.ZodString;
            maxOutputLength: z.ZodOptional<z.ZodNumber>;
            output: z.ZodArray<z.ZodObject<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">>, "many">;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }, {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call_output">;
            callId: z.ZodString;
            status: z.ZodEnum<["completed", "failed"]>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
            /**
             * The user facing representation of the reasoning. Additional information might be in the `providerData` field.
             */
            content: z.ZodArray<z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                /**
                 * A text input for example a message from a user
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">;
            /**
             * The raw reasoning text from the model.
             */
            rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"reasoning_text">;
                /**
                 * A text input for example a message from a user
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"compaction">;
            encrypted_content: z.ZodString;
            id: z.ZodOptional<z.ZodString>;
            created_by: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"unknown">;
        }, "strip", z.ZodTypeAny, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }, {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "response_done";
    response: {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    };
    providerData?: Record<string, any> | undefined;
}, {
    type: "response_done";
    response: {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    };
    providerData?: Record<string, any> | undefined;
}>;
export type StreamEventResponseCompleted = z.infer<typeof StreamEventResponseCompleted>;
/**
 * Event returned for every item that gets streamed to the model. Used to expose the raw events
 * from the model.
 */
export declare const StreamEventGenericItem: z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"model">;
    event: z.ZodAny;
}, "strip", z.ZodTypeAny, {
    type: "model";
    providerData?: Record<string, any> | undefined;
    event?: any;
}, {
    type: "model";
    providerData?: Record<string, any> | undefined;
    event?: any;
}>;
export type StreamEventGenericItem = z.infer<typeof StreamEventGenericItem>;
export declare const StreamEvent: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"output_text_delta">;
    /**
     * The delta text that was streamed by the modelto the user.
     */
    delta: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "output_text_delta";
    delta: string;
    providerData?: Record<string, any> | undefined;
}, {
    type: "output_text_delta";
    delta: string;
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"response_done">;
    /**
     * The response from the model.
     */
    response: z.ZodObject<{
        /**
         * Additional optional provider specific data. Used for custom functionality or model provider
         * specific fields.
         */
        providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    } & {
        /**
         * The ID of the response.
         */
        id: z.ZodString;
        /**
         * The usage data for the response.
         */
        usage: z.ZodObject<{
            requests: z.ZodOptional<z.ZodNumber>;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            totalTokens: z.ZodNumber;
            inputTokensDetails: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodNumber>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">]>>;
            outputTokensDetails: z.ZodOptional<z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodNumber>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodNumber>, "many">]>>;
            requestUsageEntries: z.ZodOptional<z.ZodArray<z.ZodObject<{
                inputTokens: z.ZodNumber;
                outputTokens: z.ZodNumber;
                totalTokens: z.ZodNumber;
                inputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                outputTokensDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                endpoint: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }, {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }, {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        }>;
        /**
         * The output from the model.
         */
        output: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            /**
             * Any item without a type is treated as a message
             */
            type: z.ZodOptional<z.ZodLiteral<"message">>;
        } & {
            /**
             * Representing a message from the assistant (i.e. the model)
             */
            role: z.ZodLiteral<"assistant">;
            /**
             * The status of the message.
             */
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            /**
             * The content of the message.
             */
            content: z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"output_text">;
                /**
                 * The text output from the model.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"refusal">;
                /**
                 * The refusal explanation from the model.
                 */
                refusal: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"audio">;
                /**
                 * The audio input to the model. Could be base64 encoded audio data or an object with a file ID.
                 */
                audio: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>;
                /**
                 * The format of the audio.
                 */
                format: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                /**
                 * The transcript of the audio.
                 */
                transcript: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, "strip", z.ZodTypeAny, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }, {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                /**
                 * The image input to the model. Could be base64 encoded image data or an object with a file ID.
                 */
                image: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            }>]>, "many">;
        }, "strip", z.ZodTypeAny, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"hosted_tool_call">;
            /**
             * The name of the hosted tool. For example `web_search_call` or `file_search_call`
             */
            name: z.ZodString;
            /**
             * The arguments of the hosted tool call.
             */
            arguments: z.ZodOptional<z.ZodString>;
            /**
             * The status of the tool call.
             */
            status: z.ZodOptional<z.ZodString>;
            /**
             * The primary output of the tool call. Additional output might be in the `providerData` field.
             */
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }, {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call">;
            /**
             * The ID of the tool call. Required to match up the respective tool call result.
             */
            callId: z.ZodString;
            /**
             * The name of the function.
             */
            name: z.ZodString;
            /**
             * The status of the function call.
             */
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            /**
             * The arguments of the function call.
             */
            arguments: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"computer_call">;
            /**
             * The ID of the computer call. Required to match up the respective computer call result.
             */
            callId: z.ZodString;
            /**
             * The status of the computer call.
             */
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            /**
             * The action to be performed by the computer.
             */
            action: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"screenshot">;
            }, "strip", z.ZodTypeAny, {
                type: "screenshot";
            }, {
                type: "screenshot";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                button: z.ZodEnum<["left", "right", "wheel", "back", "forward"]>;
            }, "strip", z.ZodTypeAny, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }, {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"double_click">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "double_click";
                x: number;
                y: number;
            }, {
                type: "double_click";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"scroll">;
                x: z.ZodNumber;
                y: z.ZodNumber;
                scroll_x: z.ZodNumber;
                scroll_y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }, {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"type">;
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "type";
                text: string;
            }, {
                type: "type";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"wait">;
            }, "strip", z.ZodTypeAny, {
                type: "wait";
            }, {
                type: "wait";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"move">;
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                type: "move";
                x: number;
                y: number;
            }, {
                type: "move";
                x: number;
                y: number;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"keypress">;
                keys: z.ZodArray<z.ZodString, "many">;
            }, "strip", z.ZodTypeAny, {
                keys: string[];
                type: "keypress";
            }, {
                keys: string[];
                type: "keypress";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"drag">;
                path: z.ZodArray<z.ZodObject<{
                    x: z.ZodNumber;
                    y: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    x: number;
                    y: number;
                }, {
                    x: number;
                    y: number;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }, {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call">;
            callId: z.ZodString;
            status: z.ZodOptional<z.ZodEnum<["in_progress", "completed", "incomplete"]>>;
            action: z.ZodObject<{
                commands: z.ZodArray<z.ZodString, "many">;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
                maxOutputLength: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }, {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call">;
            callId: z.ZodString;
            status: z.ZodEnum<["in_progress", "completed"]>;
            operation: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"create_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "create_file";
                diff: string;
            }, {
                path: string;
                type: "create_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"update_file">;
                path: z.ZodString;
                diff: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "update_file";
                diff: string;
            }, {
                path: string;
                type: "update_file";
                diff: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"delete_file">;
                path: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                path: string;
                type: "delete_file";
            }, {
                path: string;
                type: "delete_file";
            }>]>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"function_call_result">;
            /**
             * The name of the tool that was called
             */
            name: z.ZodString;
            /**
             * The ID of the tool call. Required to match up the respective tool call result.
             */
            callId: z.ZodString;
            /**
             * The status of the tool call.
             */
            status: z.ZodEnum<["in_progress", "completed", "incomplete"]>;
            /**
             * The output of the tool call.
             */
            output: z.ZodUnion<[z.ZodString, z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"text">;
                /**
                 * The text output from the model.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"image">;
                /**
                 * Inline image content or a reference to an uploaded file. Accepts a URL/data URL string or an
                 * object describing the data/url/fileId source.
                 */
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodUnion<[z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }, {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                }>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>, z.ZodObject<{
                    fileId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    fileId: string;
                }, {
                    fileId: string;
                }>]>]>>;
                /**
                 * Controls the requested level of detail for vision models.
                 * Use a string to avoid constraining future model capabilities.
                 */
                detail: z.ZodOptional<z.ZodType<"low" | "high" | "auto" | (string & {}), z.ZodTypeDef, "low" | "high" | "auto" | (string & {})>>;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }, {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"file">;
                /**
                 * File output reference. Provide either a string (data URL / base64), a data object (requires
                 * mediaType + filename), or an object pointing to an uploaded file/URL.
                 */
                file: z.ZodUnion<[z.ZodString, z.ZodObject<{
                    data: z.ZodUnion<[z.ZodString, z.ZodType<Uint8Array<ArrayBuffer>, z.ZodTypeDef, Uint8Array<ArrayBuffer>>]>;
                    mediaType: z.ZodString;
                    filename: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }, {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                }>, z.ZodObject<{
                    url: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                    filename?: string | undefined;
                }, {
                    url: string;
                    filename?: string | undefined;
                }>, z.ZodObject<{
                    id: z.ZodString;
                    filename: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    filename?: string | undefined;
                }, {
                    id: string;
                    filename?: string | undefined;
                }>]>;
            }, "strip", z.ZodTypeAny, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }, {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            }>]>, z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                /**
                 * A text input for example a message from a user
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_image">;
                /**
                 * The image input to the model. Could be provided inline (`image`), as a URL, or by reference to a
                 * previously uploaded OpenAI file.
                 */
                image: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>>;
                /**
                 * Controls the level of detail requested for image understanding tasks.
                 * Future models may add new values, therefore this accepts any string.
                 */
                detail: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }, {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            }>, z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_file">;
                /**
                 * The file input to the model. Could be raw data, a URL, or an OpenAI file ID.
                 * When passing a string, it is interpreted as inline data or a URL; use `{ id }` for file IDs.
                 */
                file: z.ZodOptional<z.ZodUnion<[z.ZodUnion<[z.ZodString, z.ZodObject<{
                    id: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                }, {
                    id: string;
                }>]>, z.ZodObject<{
                    url: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    url: string;
                }, {
                    url: string;
                }>]>>;
                /**
                 * Optional filename metadata when uploading file data inline.
                 */
                filename: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }, {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            }>]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"shell_call_output">;
            callId: z.ZodString;
            maxOutputLength: z.ZodOptional<z.ZodNumber>;
            output: z.ZodArray<z.ZodObject<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">>, "many">;
        }, "strip", z.ZodTypeAny, {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }, {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"apply_patch_call_output">;
            callId: z.ZodString;
            status: z.ZodEnum<["completed", "failed"]>;
            output: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }, {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            id: z.ZodOptional<z.ZodString>;
            type: z.ZodLiteral<"reasoning">;
            /**
             * The user facing representation of the reasoning. Additional information might be in the `providerData` field.
             */
            content: z.ZodArray<z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"input_text">;
                /**
                 * A text input for example a message from a user
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">;
            /**
             * The raw reasoning text from the model.
             */
            rawContent: z.ZodOptional<z.ZodArray<z.ZodObject<{
                /**
                 * Additional optional provider specific data. Used for custom functionality or model provider
                 * specific fields.
                 */
                providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
            } & {
                type: z.ZodLiteral<"reasoning_text">;
                /**
                 * A text input for example a message from a user
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }, {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }, {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        }>, z.ZodObject<{
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            type: z.ZodLiteral<"compaction">;
            encrypted_content: z.ZodString;
            id: z.ZodOptional<z.ZodString>;
            created_by: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }, {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        }>, z.ZodObject<{
            /**
             * Additional optional provider specific data. Used for custom functionality or model provider
             * specific fields.
             */
            providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
        } & {
            /**
             * An ID to identify the item. This is optional by default. If a model provider absolutely
             * requires this field, it will be validated on the model level.
             */
            id: z.ZodOptional<z.ZodString>;
        } & {
            type: z.ZodLiteral<"unknown">;
        }, "strip", z.ZodTypeAny, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }, {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        }>]>, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }, {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "response_done";
    response: {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectOutputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    };
    providerData?: Record<string, any> | undefined;
}, {
    type: "response_done";
    response: {
        id: string;
        output: ({
            status: "in_progress" | "completed" | "incomplete";
            role: "assistant";
            content: ({
                type: "refusal";
                refusal: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "output_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "audio";
                audio: string | {
                    id: string;
                };
                providerData?: Record<string, any> | undefined;
                format?: string | null | undefined;
                transcript?: string | null | undefined;
            } | {
                type: "image";
                image: string;
                providerData?: Record<string, any> | undefined;
            })[];
            type?: "message" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "hosted_tool_call";
            name: string;
            status?: string | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            arguments?: string | undefined;
            output?: string | undefined;
        } | {
            type: "function_call";
            name: string;
            arguments: string;
            callId: string;
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "function_call_result";
            status: "in_progress" | "completed" | "incomplete";
            name: string;
            output: string | {
                type: "text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType?: string | undefined;
                } | {
                    url: string;
                } | {
                    fileId: string;
                } | undefined;
                detail?: "low" | "high" | "auto" | (string & {}) | undefined;
            } | {
                type: "file";
                file: string | {
                    filename: string;
                    data: string | Uint8Array<ArrayBuffer>;
                    mediaType: string;
                } | {
                    url: string;
                    filename?: string | undefined;
                } | {
                    id: string;
                    filename?: string | undefined;
                };
                providerData?: Record<string, any> | undefined;
            } | ({
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            } | {
                type: "input_image";
                providerData?: Record<string, any> | undefined;
                image?: string | {
                    id: string;
                } | undefined;
                detail?: string | undefined;
            } | {
                type: "input_file";
                providerData?: Record<string, any> | undefined;
                file?: string | {
                    id: string;
                } | {
                    url: string;
                } | undefined;
                filename?: string | undefined;
            })[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "computer_call";
            status: "in_progress" | "completed" | "incomplete";
            callId: string;
            action: {
                type: "screenshot";
            } | {
                type: "click";
                x: number;
                y: number;
                button: "left" | "right" | "wheel" | "back" | "forward";
            } | {
                type: "double_click";
                x: number;
                y: number;
            } | {
                type: "scroll";
                x: number;
                y: number;
                scroll_x: number;
                scroll_y: number;
            } | {
                type: "type";
                text: string;
            } | {
                type: "wait";
            } | {
                type: "move";
                x: number;
                y: number;
            } | {
                keys: string[];
                type: "keypress";
            } | {
                path: {
                    x: number;
                    y: number;
                }[];
                type: "drag";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call";
            callId: string;
            action: {
                commands: string[];
                timeoutMs?: number | undefined;
                maxOutputLength?: number | undefined;
            };
            status?: "in_progress" | "completed" | "incomplete" | undefined;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "shell_call_output";
            output: z.objectInputType<{
                stdout: z.ZodString;
                stderr: z.ZodString;
                outcome: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                    type: z.ZodLiteral<"timeout">;
                }, "strip", z.ZodTypeAny, {
                    type: "timeout";
                }, {
                    type: "timeout";
                }>, z.ZodObject<{
                    type: z.ZodLiteral<"exit">;
                    exitCode: z.ZodNullable<z.ZodNumber>;
                }, "strip", z.ZodTypeAny, {
                    type: "exit";
                    exitCode: number | null;
                }, {
                    type: "exit";
                    exitCode: number | null;
                }>]>;
            }, z.ZodTypeAny, "passthrough">[];
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            maxOutputLength?: number | undefined;
        } | {
            type: "apply_patch_call";
            status: "in_progress" | "completed";
            callId: string;
            operation: {
                path: string;
                type: "create_file";
                diff: string;
            } | {
                path: string;
                type: "update_file";
                diff: string;
            } | {
                path: string;
                type: "delete_file";
            };
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        } | {
            type: "apply_patch_call_output";
            status: "completed" | "failed";
            callId: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            output?: string | undefined;
        } | {
            type: "reasoning";
            content: {
                type: "input_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[];
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            rawContent?: {
                type: "reasoning_text";
                text: string;
                providerData?: Record<string, any> | undefined;
            }[] | undefined;
        } | {
            type: "compaction";
            encrypted_content: string;
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
            created_by?: string | undefined;
        } | {
            type: "unknown";
            providerData?: Record<string, any> | undefined;
            id?: string | undefined;
        })[];
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            inputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            outputTokensDetails?: Record<string, number> | Record<string, number>[] | undefined;
            requests?: number | undefined;
            requestUsageEntries?: {
                inputTokens: number;
                outputTokens: number;
                totalTokens: number;
                inputTokensDetails?: Record<string, number> | undefined;
                outputTokensDetails?: Record<string, number> | undefined;
                endpoint?: string | undefined;
            }[] | undefined;
        };
        providerData?: Record<string, any> | undefined;
    };
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"response_started">;
}, "strip", z.ZodTypeAny, {
    type: "response_started";
    providerData?: Record<string, any> | undefined;
}, {
    type: "response_started";
    providerData?: Record<string, any> | undefined;
}>, z.ZodObject<{
    /**
     * Additional optional provider specific data. Used for custom functionality or model provider
     * specific fields.
     */
    providerData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
} & {
    type: z.ZodLiteral<"model">;
    event: z.ZodAny;
}, "strip", z.ZodTypeAny, {
    type: "model";
    providerData?: Record<string, any> | undefined;
    event?: any;
}, {
    type: "model";
    providerData?: Record<string, any> | undefined;
    event?: any;
}>]>;
export type StreamEvent = StreamEventTextStream | StreamEventResponseCompleted | StreamEventResponseStarted | StreamEventGenericItem;
export {};
