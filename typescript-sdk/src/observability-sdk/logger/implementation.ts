import {
  AnyValue,
  Logger,
} from "@opentelemetry/api-logs";
import {
  EmitOptions,
  LangWatchLogger,
  LangWatchLogRecord,
  LangWatchSpanGenAIAssistantMessageEventBody,
  LangWatchSpanGenAIChoiceEventBody,
  LangWatchSpanGenAISystemMessageEventBody,
  LangWatchSpanGenAIToolMessageEventBody,
  LangWatchSpanGenAIUserMessageEventBody,
} from "./types";
import { shouldCaptureOutput } from "../config";
import * as intSemconv from "../semconv";
import { type SemConvLogRecordAttributes } from "../semconv";
import { context } from "@opentelemetry/api";

/**
 * Internal implementation of {@link LangWatchLogger}.
 *
 * @remarks
 * This class wraps an OpenTelemetry logger and adds LangWatch-specific functionality for
 * structured logging and event emission.
 * Not intended for direct use; use {@link getLangWatchLogger} or
 * {@link createLangWatchLogger} instead.
 */
export class LangWatchLoggerInternal implements LangWatchLogger {
  constructor(private logger: Logger) {}

  emit(logRecord: LangWatchLogRecord, options?: EmitOptions): void {
    // Handle output capture configuration
    if (!shouldCaptureOutput()) {
      logRecord.body = void 0;
    }

    // Set context if not provided and not explicitly excluded
    if (!logRecord.context && !options?.excludeContext) {
      logRecord.context = context.active();
    }

    // Emit the log record through the underlying OpenTelemetry logger
    this.logger.emit(logRecord);
  }

  emitGenAISystemMessageEvent(
    body: LangWatchSpanGenAISystemMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ): void {
    if (body.role === void 0) {
      body.role = "system";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_SYSTEM_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIUserMessageEvent(
    body: LangWatchSpanGenAIUserMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "user";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_USER_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIAssistantMessageEvent(
    body: LangWatchSpanGenAIAssistantMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "assistant";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_ASSISTANT_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIToolMessageEvent(
    body: LangWatchSpanGenAIToolMessageEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.role === void 0) {
      body.role = "tool";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_TOOL_MESSAGE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  emitGenAIChoiceEvent(
    body: LangWatchSpanGenAIChoiceEventBody,
    system?: intSemconv.VAL_GEN_AI_SYSTEMS | (string & {}),
    attributes?: SemConvLogRecordAttributes,
  ) {
    if (body.message && body.message.role === void 0) {
      body.message.role = "assistant";
    }

    this.emitGenAIEvent(
      intSemconv.LOG_EVNT_GEN_AI_CHOICE,
      { ...body },
      {
        ...attributes,
        "gen_ai.system": system,
      },
    );
  }

  private emitGenAIEvent(
    eventName: string,
    body: AnyValue,
    attributes?: SemConvLogRecordAttributes,
  ): void {
    this.emit({
      eventName,
      context: context.active(),
      attributes: { ...attributes },
      body: shouldCaptureOutput() ? body : void 0,
      observedTimestamp: new Date().getTime(),
    });
  }
}
