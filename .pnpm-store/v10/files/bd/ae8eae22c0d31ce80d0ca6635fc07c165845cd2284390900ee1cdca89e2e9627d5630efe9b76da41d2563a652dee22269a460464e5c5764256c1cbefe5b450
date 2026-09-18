import { SerdeContextConfig } from "../../ConfigurableSerdeContext";
import { JsonShapeDeserializer2 } from "./JsonShapeDeserializer2";
import { JsonShapeSerializer2 } from "./JsonShapeSerializer2";
export class JsonCodec2 extends SerdeContextConfig {
    settings;
    constructor(settings) {
        super();
        this.settings = settings;
    }
    createSerializer() {
        const serializer = new JsonShapeSerializer2(this.settings);
        serializer.setSerdeContext(this.serdeContext);
        return serializer;
    }
    createDeserializer() {
        const deserializer = new JsonShapeDeserializer2(this.settings);
        deserializer.setSerdeContext(this.serdeContext);
        return deserializer;
    }
}
