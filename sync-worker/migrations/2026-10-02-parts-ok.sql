-- 3.18 : morceaux validés / en attente, place occupée comptée par morceau.
ALTER TABLE csm_parts ADD COLUMN ok INTEGER NOT NULL DEFAULT 0;
UPDATE csm_parts SET ok = 1 WHERE EXISTS (SELECT 1 FROM csm_transcripts t WHERE t.space = csm_parts.space AND t.uid = csm_parts.uid AND t.ver = csm_parts.ver);
CREATE INDEX IF NOT EXISTS csm_parts_pending ON csm_parts(space, ok);
UPDATE csm_usage SET bytes = (SELECT COALESCE(SUM(size), 0) FROM csm_parts WHERE csm_parts.space = csm_usage.space);
