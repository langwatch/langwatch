export type MeterTone = "ok" | "warn" | "error" | "neutral";

export type MeterProps = {
  label: string;
  value: number;
  max: number;
  /** The reading in words, e.g. "3.1 of 16 GB"; also the screen-reader value. */
  detail?: string;
  /** Otherwise from the share used: warn from 75%, error from 90%. */
  tone?: MeterTone;
};

const shareOf = ({ value, max }: { value: number; max: number }) =>
  max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));

const toneFor = ({ share }: { share: number }): MeterTone => {
  if (share >= 0.9) return "error";
  if (share >= 0.75) return "warn";
  return "ok";
};

export const Meter = ({ label, value, max, detail, tone }: MeterProps) => {
  const share = shareOf({ value, max });
  return (
    <div className="ds-meter" data-tone={tone ?? toneFor({ share })}>
      <meter
        className="ds-visually-hidden"
        min={0}
        max={max}
        value={value}
        aria-label={label}
        aria-valuetext={detail}
      />
      <div className="ds-meter-head" aria-hidden="true">
        <span className="ds-meter-label">{label}</span>
        {detail !== undefined && <span className="ds-meter-detail">{detail}</span>}
      </div>
      <div className="ds-meter-track" aria-hidden="true">
        <div className="ds-meter-fill" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
};
