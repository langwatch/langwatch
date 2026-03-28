ALTER TABLE trace_summaries
  ADD COLUMN IF NOT EXISTS AnnotationIds Array(String) CODEC(ZSTD(1));

ALTER TABLE trace_summaries
  ADD INDEX IF NOT EXISTS idx_annotation_ids AnnotationIds TYPE bloom_filter(0.01) GRANULARITY 4;
