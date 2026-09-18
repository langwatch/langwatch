"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechToText = void 0;
const Client_1 = require("../api/resources/speechToText/client/Client");
const realtime_1 = require("./realtime");
class SpeechToText extends Client_1.SpeechToTextClient {
    get realtime() {
        if (!this._realtime) {
            this._realtime = new realtime_1.ScribeRealtime(this._options);
        }
        return this._realtime;
    }
    convert(request, requestOptions) {
        return super.convert(request, requestOptions);
    }
}
exports.SpeechToText = SpeechToText;
